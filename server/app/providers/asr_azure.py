"""
Azure Speech-to-Text ASR Provider.

Uses Azure Cognitive Services Speech SDK for streaming recognition
with word-level timestamps.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from app.models.schemas import ASRResult, WordTimestamp
from app.providers.asr_base import ASRProvider, ASRCallback
from app.core.config import settings

logger = logging.getLogger(__name__)


class AzureSpeechProvider(ASRProvider):
    """
    Azure Speech Services streaming ASR.

    Receives PCM 16kHz/16bit/mono audio via push stream,
    returns transcription with word-level timestamps.
    """

    def __init__(self):
        self._callback: Optional[ASRCallback] = None
        self._recognizer = None
        self._push_stream = None
        self._audio_config = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._running = False

    async def start_stream(self, callback: ASRCallback) -> None:
        try:
            import azure.cognitiveservices.speech as speechsdk
        except ImportError:
            raise RuntimeError(
                "azure-cognitiveservices-speech not installed. "
                "Run: pip install azure-cognitiveservices-speech"
            )

        self._callback = callback
        self._loop = asyncio.get_event_loop()

        # Speech config
        speech_config = speechsdk.SpeechConfig(
            subscription=settings.AZURE_SPEECH_KEY,
            region=settings.AZURE_SPEECH_REGION,
        )
        speech_config.speech_recognition_language = "zh-CN"
        speech_config.request_word_level_timestamps()
        speech_config.set_property(
            speechsdk.PropertyId.SpeechServiceResponse_OutputFormatOption,
            "Detailed"
        )

        # Push stream for feeding audio
        audio_format = speechsdk.audio.AudioStreamFormat(
            samples_per_second=16000,
            bits_per_sample=16,
            channels=1,
        )
        self._push_stream = speechsdk.audio.PushAudioInputStream(audio_format)
        self._audio_config = speechsdk.audio.AudioConfig(stream=self._push_stream)

        # Create recognizer
        self._recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config,
            audio_config=self._audio_config,
        )

        # Wire callbacks
        self._recognizer.recognizing.connect(self._on_recognizing)
        self._recognizer.recognized.connect(self._on_recognized)
        self._recognizer.canceled.connect(self._on_canceled)
        # Some SDK versions expose session_stopped; use it when available.
        if hasattr(self._recognizer, "session_stopped"):
            self._recognizer.session_stopped.connect(self._on_session_stopped)

        # Start continuous recognition
        self._recognizer.start_continuous_recognition_async().get()
        self._running = True
        logger.info("Azure ASR stream started")

    async def feed_audio(self, pcm_bytes: bytes) -> None:
        if self._running and self._push_stream:
            self._push_stream.write(pcm_bytes)

    async def stop_stream(self) -> None:
        self._running = False
        if self._push_stream:
            self._push_stream.close()
            self._push_stream = None
        if self._recognizer:
            self._recognizer.stop_continuous_recognition_async()
            self._recognizer = None
        logger.info("Azure ASR stream stopped")

    async def close(self) -> None:
        await self.stop_stream()
        self._recognizer = None
        self._push_stream = None

    @property
    def is_alive(self) -> bool:
        """True if the push stream and recognizer are still active."""
        return self._running and self._push_stream is not None and self._recognizer is not None

    # ── SDK callbacks (run in SDK thread, need to bridge to asyncio) ──

    def _on_recognizing(self, evt):
        """Interim (partial) result."""
        result = self._parse_result(evt.result, is_final=False)
        if self._callback and self._loop:
            asyncio.run_coroutine_threadsafe(
                self._callback(result), self._loop
            )

    def _on_recognized(self, evt):
        """Final result for an utterance."""
        result = self._parse_result(evt.result, is_final=True)
        if self._callback and self._loop:
            asyncio.run_coroutine_threadsafe(
                self._callback(result), self._loop
            )

    def _on_canceled(self, evt):
        logger.warning(f"Azure ASR canceled: {evt.cancellation_details}")
        self._running = False

    def _on_session_stopped(self, _evt):
        logger.warning("Azure ASR session stopped")
        self._running = False

    def _parse_result(self, result, is_final: bool) -> ASRResult:
        """Convert Azure SDK result to our standard ASRResult."""
        import azure.cognitiveservices.speech as speechsdk
        import json

        text = result.text or ""
        words: list[WordTimestamp] = []

        if is_final and result.reason == speechsdk.ResultReason.RecognizedSpeech:
            # Extract word-level timestamps from detailed result JSON
            try:
                details_json = result.properties.get(
                    speechsdk.PropertyId.SpeechServiceResponse_JsonResult, ""
                )
                if details_json:
                    details = json.loads(details_json)
                    best = details.get("NBest", [{}])[0]
                    for w in best.get("Words", []):
                        # Azure returns Offset and Duration in ticks (100ns units)
                        offset_ms = int(w.get("Offset", 0)) // 10000
                        duration_ms = int(w.get("Duration", 0)) // 10000
                        words.append(WordTimestamp(
                            word=w.get("Word", ""),
                            start_ms=offset_ms,
                            end_ms=offset_ms + duration_ms,
                        ))
            except Exception as e:
                logger.warning(f"Failed to parse word timestamps: {e}")

        return ASRResult(
            text=text,
            words=words,
            is_final=is_final,
            language="zh-CN",
        )
