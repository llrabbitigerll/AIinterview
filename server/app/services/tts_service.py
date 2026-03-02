"""
TTS Service — Qwen3-TTS-Flash synthesis via DashScope SDK.

Wraps DashScope audio.qwen_tts.SpeechSynthesizer in an async-friendly interface.
Called from session_manager during agent response streaming to produce audio
for each sentence chunk, in parallel with LLM generation.

Voices used:
  - Ethan (晨煦): agent_b in double-agent mode
  - Kai   (凯):   agent_c in double-agent mode, and single-agent mode
"""
from __future__ import annotations

import asyncio
import logging
import re

from app.core.config import settings

logger = logging.getLogger(__name__)

# Regex to strip common Markdown syntax before sending to TTS
_MD_STRIP = re.compile(
    r"```.*?```"          # fenced code blocks
    r"|`[^`]*`"           # inline code
    r"|\*\*([^*]*)\*\*"   # bold
    r"|\*([^*]*)\*"       # italic
    r"|__([^_]*)__"       # bold alt
    r"|_([^_]*)_"         # italic alt
    r"|#{1,6}\s*"         # headings
    r"|\[([^\]]*)\]\([^)]*\)",  # links → keep link text
    re.DOTALL,
)

# Sentence boundary punctuation
_SENTENCE_PUNCT = re.compile(r"[。！？…\n!?]")

# Chunk size limits
MIN_CHUNK_CHARS = 6   # ≤ 6 chars: don't dispatch, merge into next chunk
MAX_CHUNK_CHARS = 50  # ≥ 50 chars: force-flush even without punctuation


def _clean_text(text: str) -> str:
    """Strip Markdown from text before sending to TTS."""
    cleaned = _MD_STRIP.sub(lambda m: m.group(1) or m.group(2) or m.group(3) or m.group(4) or m.group(5) or "", text)
    # Collapse multiple spaces/newlines
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


async def synthesize(text: str, voice: str) -> bytes | None:
    """
    Synthesize `text` to WAV audio using qwen3-tts-flash.

    Args:
        text:  The text to synthesize (Markdown will be stripped automatically).
        voice: DashScope voice name, e.g. "Kai" or "Ethan".

    Returns:
        Raw WAV bytes, or None if synthesis failed (caller should skip audio gracefully).
    """
    if not settings.TTS_ENABLED:
        logger.info("[TTS] TTS_ENABLED=False, skipping")
        return None

    clean = _clean_text(text)
    if not clean:
        logger.warning("[TTS] cleaned text is empty, skipping")
        return None

    logger.info(f"[TTS] synthesize: '{clean[:40]}...' voice={voice}")
    try:
        wav_bytes = await asyncio.to_thread(_synthesize_sync, clean, voice)
        logger.info(f"[TTS] synthesize OK: {len(wav_bytes)} bytes")
        return wav_bytes
    except Exception as exc:
        logger.warning(f"[TTS] synthesize failed (voice={voice}): {exc}")
        return None


def _synthesize_sync(text: str, voice: str) -> bytes:
    """Synchronous DashScope TTS call — run via asyncio.to_thread."""
    from dashscope.audio.qwen_tts import SpeechSynthesizer

    response = SpeechSynthesizer.call(
        model=settings.TTS_MODEL,
        api_key=settings.QWEN_API_KEY,
        text=text,
        voice=voice,
    )

    if response.status_code != 200:
        raise RuntimeError(f"TTS API error {response.status_code}: {response.code} — {response.message}")

    # response.output.audio is a plain dict: {"data": "", "url": "...", ...}
    try:
        audio: dict = response.output.audio
        if not isinstance(audio, dict):
            raise TypeError(f"Expected dict, got {type(audio)}")
    except (AttributeError, TypeError) as exc:
        raise RuntimeError(f"Unexpected TTS response structure: {exc}\nResponse: {response}") from exc

    audio_data: str = audio.get("data", "")
    audio_url: str = audio.get("url", "")

    if audio_data:
        import base64
        return base64.b64decode(audio_data)

    if audio_url:
        import urllib.request
        with urllib.request.urlopen(audio_url, timeout=15) as resp:
            return resp.read()

    raise RuntimeError("TTS returned neither audio data nor URL")


def iter_tts_chunks(token_stream):
    """
    Generator helper: yields (chunk_text, tasks_list_ref) tuples for TTS dispatching.

    This is NOT used directly — the logic is inlined in session_manager for clarity.
    Kept here as documentation of the chunking algorithm.

    Rules:
      1. Accumulate tokens into buffer.
      2. On each token:
         - if buffer >= MAX_CHUNK_CHARS: force-flush (MAX priority over punctuation logic)
         - elif token contains sentence punctuation AND buffer > MIN_CHUNK_CHARS: flush
         - elif token contains sentence punctuation AND buffer <= MIN_CHUNK_CHARS: keep (merge)
      3. After stream ends: flush remaining buffer.
    """
    buffer = ""
    for token in token_stream:
        buffer += token
        if len(buffer) >= MAX_CHUNK_CHARS:
            yield buffer.strip()
            buffer = ""
        elif _SENTENCE_PUNCT.search(token) and len(buffer) > MIN_CHUNK_CHARS:
            yield buffer.strip()
            buffer = ""
        # else: keep accumulating
    if buffer.strip():
        yield buffer.strip()
