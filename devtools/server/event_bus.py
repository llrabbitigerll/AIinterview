"""
DevTools Event Bus — In-memory pub/sub for all captured events.

Events are published by spy.py patches and consumed by devtools_app.py
WebSocket subscribers. Thread-safe via asyncio.Queue.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from devtools.server.event_archive import archive


class EventBus:
    """Single asyncio event bus with multi-subscriber fan-out."""

    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        """Create and register a new subscriber queue."""
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        """Remove a subscriber queue."""
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    def publish(self, event_type: str, payload: Any, session_id: str = "") -> None:
        """
        Publish an event to all subscribers (non-blocking).
        Drops events when subscriber queue is full so the main app is never blocked.
        """
        event = {
            "type": event_type,
            "timestamp": time.time(),
            "session_id": session_id,
            "payload": payload,
        }

        try:
            archive.record(event)
        except Exception:
            # Archiving is best-effort and must never affect the main flow.
            pass

        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Subscriber too slow — drop oldest, insert new
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except Exception:
                    pass

    async def publish_async(self, event_type: str, payload: Any, session_id: str = "") -> None:
        """Async variant — await-friendly, still non-blocking (delegates to publish)."""
        self.publish(event_type, payload, session_id)


# ── Global singleton ─────────────────────────────────────────
bus = EventBus()


# ── Event type constants ─────────────────────────────────────
class E:
    # WebSocket traffic
    WS_C2S = "ws_c2s"                  # client → server JSON message
    WS_S2C = "ws_s2c"                  # server → client JSON message
    WS_BINARY = "ws_binary"            # binary PCM frame (size only)
    WS_CONNECTED = "ws_connected"      # new WS connection
    WS_DISCONNECTED = "ws_disconnected"

    # LLM calls
    LLM_CALL_START = "llm_call_start"
    LLM_CALL_END = "llm_call_end"
    LLM_STREAM_START = "llm_stream_start"
    LLM_STREAM_TOKEN = "llm_stream_token"
    LLM_STREAM_END = "llm_stream_end"

    # Agent A orchestration
    AGENT_DECISION = "agent_decision"

    # Blackboard state
    BLACKBOARD_SNAPSHOT = "blackboard_snapshot"

    # Background evaluation
    EVAL_RESULT = "eval_result"

    # Research agent phases
    RESEARCH_PHASE_START = "research_phase_start"
    RESEARCH_PHASE_END = "research_phase_end"

    # Python log records
    LOG_RECORD = "log_record"

    # Session lifecycle
    SESSION_START = "session_start"
    SESSION_END = "session_end"
