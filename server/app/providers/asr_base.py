"""
ASR Provider — Abstract interface for speech-to-text services.

All providers must implement this interface to ensure
uniform transcription results regardless of backend (Azure / iFlytek).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Callable, Awaitable

from app.models.schemas import ASRResult


# Callback type: receives ASRResult each time transcription is available
ASRCallback = Callable[[ASRResult], Awaitable[None]]


class ASRProvider(ABC):
    """Abstract base class for ASR streaming providers."""

    @abstractmethod
    async def start_stream(self, callback: ASRCallback) -> None:
        """Start a new streaming recognition session."""
        ...

    @abstractmethod
    async def feed_audio(self, pcm_bytes: bytes) -> None:
        """Feed raw PCM audio bytes (16kHz, 16-bit, mono, little-endian)."""
        ...

    @abstractmethod
    async def stop_stream(self) -> None:
        """Stop the streaming session and flush remaining audio."""
        ...

    @abstractmethod
    async def close(self) -> None:
        """Release all resources."""
        ...
