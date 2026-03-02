"""
iFlytek 实时语音转写大模型 ASR Provider.

API: wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1
Docs: https://www.xfyun.cn/doc/spark/asr_llm/rtasr_llm.html

Auth: HMAC-SHA1 签名（新版大模型接口）
  - 所有请求参数（除 signature）按 key 升序排序
  - URL 编码后拼接为 baseString
  - HMAC-SHA1(accessKeySecret, baseString) -> Base64 -> signature
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import uuid as _uuid_module
from datetime import datetime, timezone, timedelta
from typing import Optional
from urllib.parse import urlencode, quote

import websockets

from app.models.schemas import ASRResult, WordTimestamp
from app.providers.asr_base import ASRProvider, ASRCallback
from app.core.config import settings

logger = logging.getLogger(__name__)

# New large-model RTASR endpoint — path is /ast/communicate/v1
IFLYTEK_LLM_ASR_BASE = "wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1"


class IFlytekProvider(ASRProvider):
    """
    iFlytek 实时语音转写大模型 ASR provider.

    Uses the new endpoint: wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1
    Auth: appId + accessKeyId + utc + signature (HMAC-SHA1 over sorted params).
    """

    def __init__(self):
        self._callback: Optional[ASRCallback] = None
        self._ws = None
        self._send_task: Optional[asyncio.Task] = None
        self._recv_task: Optional[asyncio.Task] = None
        self._audio_queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue()
        self._running = False
        self._start_error: str | None = None
        self._session_id: str = ""
        self._server_session_id: str = ""  # server-assigned sessionId from handshake

    async def start_stream(self, callback: ASRCallback) -> None:
        if not settings.IFLYTEK_APP_ID or not settings.IFLYTEK_API_KEY:
            raise ValueError(
                "iFlytek ASR 未配置凭证，请在 server/.env 中设置 "
                "IFLYTEK_APP_ID 和 IFLYTEK_API_KEY"
            )
        if not settings.IFLYTEK_API_SECRET:
            raise ValueError(
                "iFlytek ASR 大模型接口需要 IFLYTEK_API_SECRET，请在 server/.env 中设置"
            )

        self._callback = callback
        self._running = True
        self._start_error = None
        self._session_id = str(_uuid_module.uuid4())
        self._server_session_id = ""

        url = self._build_auth_url()
        logger.debug(f"iFlytek LLM ASR connecting to {IFLYTEK_LLM_ASR_BASE}")

        try:
            self._ws = await websockets.connect(url, open_timeout=10)
        except Exception as e:
            raise RuntimeError(f"iFlytek RTASR 连接失败: {e}") from e
        logger.info("iFlytek LLM RTASR WebSocket connected")

        self._send_task = asyncio.create_task(self._send_loop())
        self._recv_task = asyncio.create_task(self._recv_loop())

        # Wait briefly to catch immediate auth errors
        await asyncio.sleep(1.0)
        if self._start_error:
            self._running = False
            raise RuntimeError(f"iFlytek RTASR 认证失败: {self._start_error}")

    async def feed_audio(self, pcm_bytes: bytes) -> None:
        if self._running:
            await self._audio_queue.put(pcm_bytes)

    async def stop_stream(self) -> None:
        self._running = False
        await self._audio_queue.put(None)

        if self._send_task:
            try:
                await asyncio.wait_for(self._send_task, timeout=3.0)
            except asyncio.TimeoutError:
                self._send_task.cancel()

        # Send end signal with sessionId
        if self._ws:
            try:
                end_session_id = self._server_session_id or self._session_id
                await self._ws.send(json.dumps({"end": True, "sessionId": end_session_id}))
            except Exception:
                pass

        if self._recv_task:
            try:
                await asyncio.wait_for(self._recv_task, timeout=5.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._recv_task.cancel()
                try:
                    await self._recv_task
                except asyncio.CancelledError:
                    pass

    async def close(self) -> None:
        await self.stop_stream()
        if self._recv_task:
            self._recv_task.cancel()
            try:
                await self._recv_task
            except asyncio.CancelledError:
                pass
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None
        logger.info("iFlytek LLM RTASR closed")

    @property
    def is_alive(self) -> bool:
        """True if the WebSocket is still open and the recv loop is running."""
        if not self._running:
            return False
        if self._ws is None:
            return False

        # websockets version compatibility:
        # - legacy protocol exposed `.closed`
        # - newer ClientConnection exposes `.state` / `.close_code`
        ws_obj = self._ws
        closed_attr = getattr(ws_obj, "closed", None)
        if isinstance(closed_attr, bool) and closed_attr:
            return False

        state = getattr(ws_obj, "state", None)
        if state is not None:
            try:
                state_name = getattr(state, "name", str(state)).upper()
                if state_name in {"CLOSING", "CLOSED"}:
                    return False
            except Exception:
                pass

        close_code = getattr(ws_obj, "close_code", None)
        if close_code is not None:
            return False

        if self._recv_task is None or self._recv_task.done():
            return False
        return True

    # ---- Auth ---------------------------------------------------------------

    def _build_auth_url(self) -> str:
        """
        Build authenticated URL per iFlytek 大模型实时语音转写 spec.

        Signature:
          1. Sort all params (excluding signature) by key ascending
          2. URL-encode each key and value, join as key=value&...
          3. HMAC-SHA1(accessKeySecret, baseString) -> Base64
        """
        app_id = settings.IFLYTEK_APP_ID
        access_key_id = settings.IFLYTEK_API_KEY
        access_key_secret = settings.IFLYTEK_API_SECRET

        # utc format: 2025-09-04T15:38:07+0800
        tz_cst = timezone(timedelta(hours=8))
        utc_str = datetime.now(tz=tz_cst).strftime("%Y-%m-%dT%H:%M:%S+0800")

        params: dict[str, str] = {
            "appId": app_id,
            "accessKeyId": access_key_id,
            "uuid": self._session_id,
            "utc": utc_str,
            "lang": "autodialect",
            "audio_encode": "pcm_s16le",
            "samplerate": "16000",
        }

        # Build baseString: sort by key, URL-encode each key & value, join with &
        sorted_keys = sorted(params.keys())
        parts = [f"{quote(k, safe='')}={quote(params[k], safe='')}" for k in sorted_keys]
        base_string = "&".join(parts)

        # HMAC-SHA1(accessKeySecret, baseString) -> Base64
        sig_bytes = hmac.new(
            access_key_secret.encode("utf-8"),
            base_string.encode("utf-8"),
            hashlib.sha1,
        ).digest()
        signature = base64.b64encode(sig_bytes).decode("utf-8")

        params["signature"] = signature
        return f"{IFLYTEK_LLM_ASR_BASE}?{urlencode(params)}"

    # ---- Send loop ----------------------------------------------------------

    async def _send_loop(self) -> None:
        try:
            while self._running:
                chunk = await self._audio_queue.get()
                if chunk is None:
                    break
                if self._ws:
                    await self._ws.send(chunk)
                    await asyncio.sleep(0.04)  # 40ms interval recommended by iFlytek
        except Exception as e:
            logger.error(f"iFlytek send error: {e}")
            self._running = False

    # ---- Receive loop -------------------------------------------------------

    async def _recv_loop(self) -> None:
        try:
            async for message in self._ws:
                if isinstance(message, str):
                    await self._handle_result(message)
        except websockets.exceptions.ConnectionClosed as e:
            logger.info(f"iFlytek LLM RTASR connection closed: {e.code} {e.reason}")
            self._running = False
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"iFlytek recv error: {e}")
            self._running = False
        finally:
            # Ensure liveness reflects actual transport state even if loop exits quietly.
            self._running = False

    async def _handle_result(self, raw: str) -> None:
        """
        Parse iFlytek 大模型实时语音转写 result.

        Normal result format:
          {
            "msg_type": "result",
            "res_type": "asr",
            "data": {
              "seg_id": 0,
              "ls": false,        # true = last frame of entire session
              "cn": {
                "st": {
                  "bg": 930,      # sentence start ms
                  "ed": 2590,     # sentence end ms (0 for intermediate)
                  "type": "0",    # "0"=final utterance, "1"=intermediate
                  "rt": [{"ws": [{"cw": [{"w":"词","wp":"n","wb":15,"we":64}], "wb":15,"we":64}]}]
                }
              }
            }
          }

        Error result format:
          {
            "msg_type": "result",
            "res_type": "frc",
            "data": {"desc": "...", "fnType": "ast", "normal": false}
          }
        """
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning(f"iFlytek: failed to parse JSON: {raw[:100]}")
            return

        msg_type = data.get("msg_type")
        res_type = data.get("res_type")

        # ---- Error / non-normal result ----
        if res_type == "frc":
            err_data = data.get("data", {})
            desc = err_data.get("desc", "unknown error")
            logger.error(f"iFlytek RTASR error result: {desc}")
            if any(kw in desc.lower() for kw in ["auth", "sign", "鉴权", "签名", "appid", "access", "账号"]):
                self._start_error = f"讯飞ASR认证失败: {desc}"
                self._running = False
            return

        # ---- Numeric error codes ----
        code = data.get("code")
        if code and str(code) != "0":
            desc = data.get("desc", "unknown error")
            logger.error(f"iFlytek RTASR error: code={code}, desc={desc}")
            auth_error_codes = {
                "35001", "35010", "35017", "35019", "35030",
                "100002", "100016", "100020",
                "10105", "10106", "10110",
            }
            if str(code) in auth_error_codes:
                self._start_error = f"讯飞ASR认证失败 code={code}: {desc}"
                self._running = False
            return

        # ---- Handshake confirmation ----
        if msg_type == "action":
            action_data = data.get("data", {})
            action_name = action_data.get("action", "")
            if action_name == "started":
                self._server_session_id = action_data.get("sessionId", "")
                logger.info(f"iFlytek RTASR session started: serverSessionId={self._server_session_id}")
            else:
                logger.debug(f"iFlytek action message: {action_name}")
            return

        if msg_type != "result" or res_type != "asr":
            logger.debug(f"iFlytek non-ASR message: msg_type={msg_type} res_type={res_type}")
            return

        result_data = data.get("data", {})
        if not result_data:
            return

        cn = result_data.get("cn", {})
        st = cn.get("st", {})

        # type: "0" = final utterance, "1" = intermediate
        is_final_utterance = st.get("type") == "0"
        sentence_begin_ms = int(st.get("bg", 0))

        text_parts: list[str] = []
        words: list[WordTimestamp] = []

        for rt in st.get("rt", []):
            for ws_item in rt.get("ws", []):
                ws_wb = int(ws_item.get("wb", 0)) * 10  # frame -> ms
                ws_we = int(ws_item.get("we", 0)) * 10

                for cw in ws_item.get("cw", []):
                    word = cw.get("w", "")
                    wp = cw.get("wp", "n")
                    if not word.strip() or wp == "g":  # skip segment markers
                        continue
                    text_parts.append(word)
                    if is_final_utterance and ws_wb > 0:
                        wb_ms = int(cw.get("wb", ws_wb // 10)) * 10 if "wb" in cw else ws_wb
                        we_ms = int(cw.get("we", ws_we // 10)) * 10 if "we" in cw else ws_we
                        words.append(WordTimestamp(
                            word=word,
                            start_ms=sentence_begin_ms + wb_ms,
                            end_ms=sentence_begin_ms + we_ms,
                        ))

        text = "".join(text_parts)
        if text.strip() and self._callback:
            await self._callback(ASRResult(
                text=text,
                words=words,
                is_final=is_final_utterance,
                language="zh-CN",
            ))
