"""
WebSocket endpoint for interview sessions.

Handles:
- Binary frames: PCM audio from client → routed to ASR provider
- JSON frames: Control messages (init, speech_end, text_input, control, ping)

Server sends:
- JSON: transcription, agent_response, state_sync, interview_end, error, pong
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.session_manager import InterviewSession, SessionManager

logger = logging.getLogger(__name__)
router = APIRouter()

# Global session manager
session_mgr = SessionManager()


@router.websocket("/ws/interview")
async def ws_interview(ws: WebSocket):
    """Main WebSocket endpoint for a single interview client."""
    await ws.accept()
    session: InterviewSession | None = None
    logger.info("Client connected")

    try:
        while True:
            raw = await ws.receive()

            # ── Binary frame: PCM audio ────────────────────
            if "bytes" in raw and raw["bytes"]:
                pcm_bytes: bytes = raw["bytes"]
                if session:
                    await session.feed_audio(pcm_bytes)
                continue

            # ── Text frame: JSON control message ───────────
            if "text" in raw and raw["text"]:
                try:
                    msg: dict[str, Any] = json.loads(raw["text"])
                except json.JSONDecodeError:
                    await _send_error(ws, "INVALID_JSON", "Could not parse message")
                    continue

                msg_type = msg.get("type")

                # ── Ping ───────────────────────────────────
                if msg_type == "ping":
                    await ws.send_json({
                        "type": "pong",
                        "timestamp": msg.get("timestamp", time.time()),
                    })

                # ── Init Interview ─────────────────────────
                elif msg_type == "init_interview":
                    interview_id = msg.get("interviewId", "")
                    config = msg.get("config", {})
                    session = await session_mgr.create_session(
                        interview_id=interview_id,
                        config=config,
                        ws=ws,
                    )
                    logger.info(f"Session created: {interview_id}")

                # ── Speech End (VAD) ───────────────────────
                elif msg_type == "speech_end":
                    if session:
                        await session.on_speech_end()

                # ── Text Input ─────────────────────────────
                elif msg_type == "text_input":
                    text = msg.get("text", "")
                    fluency_payload = msg.get("fluencyPayload")
                    if session and text.strip():
                        await session.on_user_text(text, fluency_payload=fluency_payload)

                # ── Code Submit ────────────────────────────
                elif msg_type == "code_submit":
                    code = msg.get("code", "")
                    language = msg.get("language", "")
                    if session and code.strip():
                        # Format code as a fenced code block and process as user text
                        formatted = f"```{language}\n{code}\n```"
                        await session.on_user_text(formatted)

                # ── Control ────────────────────────────────
                elif msg_type == "control":
                    action = msg.get("action")
                    if session:
                        if action == "pause":
                            await session.pause()
                        elif action == "resume":
                            await session.resume()
                        elif action == "end":
                            await session.end()

                # ── TTS Playback Complete ──────────────────
                elif msg_type == "tts_playback_done":
                    if session:
                        await session.on_tts_playback_done()

                else:
                    await _send_error(ws, "UNKNOWN_TYPE", f"Unknown message type: {msg_type}")

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as exc:
        logger.exception(f"WebSocket error: {exc}")
        await _send_error(ws, "INTERNAL", str(exc))
    finally:
        if session:
            await session_mgr.remove_session(session.interview_id)


async def _send_error(ws: WebSocket, code: str, message: str):
    try:
        await ws.send_json({
            "type": "error",
            "code": code,
            "message": message,
            "seq": 0,
        })
    except Exception:
        pass
