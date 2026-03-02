"""
ASR Provider Factory.

Creates the appropriate ASR provider based on configuration.
"""
from app.core.config import settings
from app.providers.asr_base import ASRProvider


def create_asr_provider() -> ASRProvider:
    """Factory function to create the configured ASR provider."""
    if settings.ASR_PROVIDER == "azure":
        from app.providers.asr_azure import AzureSpeechProvider
        return AzureSpeechProvider()
    elif settings.ASR_PROVIDER == "iflytek":
        from app.providers.asr_iflytek import IFlytekProvider
        return IFlytekProvider()
    else:
        raise ValueError(f"Unknown ASR provider: {settings.ASR_PROVIDER}")
