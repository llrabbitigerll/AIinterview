"""
REST API endpoints for non-realtime operations:
- Resume upload & parsing
- Company intelligence pre-research
- Interview history
- Report retrieval
- Settings read/write
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

from app.agents.resume_agent import ResumePreprocessor
from app.services.research_service import research_service
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Path to the .env file used by the server
_ENV_PATH = Path(__file__).resolve().parents[3] / ".env"


class ResumeParseResponse(BaseModel):
    structured_json: dict
    cheat_sheet: str


@router.post("/resume/parse", response_model=ResumeParseResponse)
async def parse_resume(file: UploadFile = File(...)):
    """Upload a resume PDF/DOCX and get structured data back."""
    if not file.filename:
        raise HTTPException(400, "No file provided")

    content = await file.read()
    filename_lower = file.filename.lower()

    # Extract text based on file type
    if filename_lower.endswith(".pdf"):
        try:
            import pdfplumber
            import io
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                raw_text = "\n".join(
                    page.extract_text() or "" for page in pdf.pages
                )
        except Exception as e:
            logger.error(f"PDF parse error: {e}")
            raise HTTPException(400, f"Failed to parse PDF: {e}")
    elif filename_lower.endswith(".docx"):
        try:
            import docx
            import io
            doc = docx.Document(io.BytesIO(content))
            raw_text = "\n".join(
                para.text for para in doc.paragraphs if para.text.strip()
            )
        except Exception as e:
            logger.error(f"DOCX parse error: {e}")
            raise HTTPException(400, f"Failed to parse DOCX: {e}")
    else:
        raise HTTPException(400, "仅支持 PDF 或 DOCX 格式，请重新上传")

    if not raw_text.strip():
        raise HTTPException(400, "Empty resume content")

    # Parse with LLM
    preprocessor = ResumePreprocessor()
    result = await preprocessor.parse(raw_text)

    return ResumeParseResponse(
        structured_json=result,
        cheat_sheet=result.get("interview_cheat_sheet", ""),
    )


@router.get("/health")
async def api_health():
    return {"status": "ok"}


# ── Company Intelligence Research ────────────────────────────

class ResearchStartRequest(BaseModel):
    interview_id: str
    company: str
    business_unit: str
    position_type: str
    candidate_tech_stack: list[str] = []


class ResearchStatusResponse(BaseModel):
    interview_id: str
    status: str            # pending | phase1 | phase2 | phase3 | completed | failed
    error: Optional[str] = None
    summary_preview: Optional[str] = None   # first 300 chars of summary when completed


@router.post("/research/start")
async def start_research(req: ResearchStartRequest):
    """
    Kick off company intelligence pre-research in background.
    Returns immediately; poll /research/{id}/status for progress.
    """
    if not req.interview_id:
        raise HTTPException(400, "interview_id is required")
    if not req.company or not req.business_unit:
        raise HTTPException(400, "company and business_unit are required")

    brief = await research_service.start_research(
        interview_id=req.interview_id,
        company=req.company,
        business_unit=req.business_unit,
        position_type=req.position_type or "backend",
        candidate_tech_stack=req.candidate_tech_stack,
    )
    return {
        "interview_id": brief.interview_id,
        "status": brief.status,
        "message": "Research started. Poll /api/research/{id}/status for progress.",
    }


@router.get("/research/{interview_id}/status", response_model=ResearchStatusResponse)
async def get_research_status(interview_id: str):
    """Poll the status of an in-progress or completed research task."""
    brief = research_service.get_brief(interview_id)
    if not brief:
        raise HTTPException(404, f"No research found for interview_id={interview_id}")

    preview = None
    if brief.status == "completed" and brief.summary:
        preview = brief.summary[:400]

    return ResearchStatusResponse(
        interview_id=brief.interview_id,
        status=brief.status,
        error=brief.error,
        summary_preview=preview,
    )


# ── Settings ─────────────────────────────────────────────────

def _mask_key(value: str) -> str:
    """Return masked version of an API key, or empty string if not set."""
    if not value:
        return ""
    if len(value) <= 8:
        return "***"
    return value[:4] + "***" + value[-3:]


class SettingsResponse(BaseModel):
    # Per-module LLM
    resume_llm_provider: str
    resume_llm_model: str
    interview_llm_provider: str
    interview_llm_model: str
    research_llm_provider: str
    research_llm_model: str
    eval_llm_provider: str
    eval_llm_model: str
    # API keys (masked)
    qwen_api_key_masked: str
    moonshot_api_key_masked: str
    # ASR — iFlytek
    iflytek_app_id: str
    iflytek_api_key_masked: str
    iflytek_api_secret_masked: str
    # TTS
    tts_enabled: bool
    tts_model: str


class SettingsSaveRequest(BaseModel):
    # Per-module LLM
    resume_llm_provider: Optional[str] = None
    resume_llm_model: Optional[str] = None
    interview_llm_provider: Optional[str] = None
    interview_llm_model: Optional[str] = None
    research_llm_provider: Optional[str] = None
    research_llm_model: Optional[str] = None
    eval_llm_provider: Optional[str] = None
    eval_llm_model: Optional[str] = None
    # API keys (plain; only written if non-empty)
    qwen_api_key: Optional[str] = None
    moonshot_api_key: Optional[str] = None
    # ASR — iFlytek
    iflytek_app_id: Optional[str] = None
    iflytek_api_key: Optional[str] = None
    iflytek_api_secret: Optional[str] = None
    # TTS
    tts_enabled: Optional[bool] = None


@router.get("/settings", response_model=SettingsResponse)
async def get_settings():
    """Return current configuration (API keys masked)."""
    return SettingsResponse(
        resume_llm_provider=settings.RESUME_LLM_PROVIDER,
        resume_llm_model=settings.RESUME_LLM_MODEL,
        interview_llm_provider=settings.INTERVIEW_LLM_PROVIDER,
        interview_llm_model=settings.INTERVIEW_LLM_MODEL,
        research_llm_provider=settings.RESEARCH_LLM_PROVIDER,
        research_llm_model=settings.RESEARCH_LLM_MODEL,
        eval_llm_provider=settings.EVAL_LLM_PROVIDER,
        eval_llm_model=settings.EVAL_LLM_MODEL,
        qwen_api_key_masked=_mask_key(settings.QWEN_API_KEY),
        moonshot_api_key_masked=_mask_key(settings.MOONSHOT_API_KEY),
        iflytek_app_id=settings.IFLYTEK_APP_ID,
        iflytek_api_key_masked=_mask_key(settings.IFLYTEK_API_KEY),
        iflytek_api_secret_masked=_mask_key(settings.IFLYTEK_API_SECRET),
        tts_enabled=settings.TTS_ENABLED,
        tts_model=settings.TTS_MODEL,
    )


@router.post("/settings")
async def save_settings(req: SettingsSaveRequest):
    """Persist settings to .env and hot-reload configuration."""
    from dotenv import set_key, load_dotenv
    import app.core.config as config_module

    env_path = _ENV_PATH
    if not env_path.parent.exists():
        env_path.parent.mkdir(parents=True, exist_ok=True)
    if not env_path.exists():
        env_path.touch()

    # Build mapping of env-key → value (skip None values)
    updates: dict[str, str] = {}

    if req.resume_llm_provider is not None:
        updates["RESUME_LLM_PROVIDER"] = req.resume_llm_provider
    if req.resume_llm_model is not None:
        updates["RESUME_LLM_MODEL"] = req.resume_llm_model
    if req.interview_llm_provider is not None:
        updates["INTERVIEW_LLM_PROVIDER"] = req.interview_llm_provider
    if req.interview_llm_model is not None:
        updates["INTERVIEW_LLM_MODEL"] = req.interview_llm_model
    if req.research_llm_provider is not None:
        updates["RESEARCH_LLM_PROVIDER"] = req.research_llm_provider
    if req.research_llm_model is not None:
        updates["RESEARCH_LLM_MODEL"] = req.research_llm_model
    if req.eval_llm_provider is not None:
        updates["EVAL_LLM_PROVIDER"] = req.eval_llm_provider
    if req.eval_llm_model is not None:
        updates["EVAL_LLM_MODEL"] = req.eval_llm_model
    if req.qwen_api_key:
        updates["QWEN_API_KEY"] = req.qwen_api_key
    if req.moonshot_api_key:
        updates["MOONSHOT_API_KEY"] = req.moonshot_api_key
    if req.iflytek_app_id is not None:
        updates["IFLYTEK_APP_ID"] = req.iflytek_app_id
    if req.iflytek_api_key:
        updates["IFLYTEK_API_KEY"] = req.iflytek_api_key
    if req.iflytek_api_secret:
        updates["IFLYTEK_API_SECRET"] = req.iflytek_api_secret
    if req.tts_enabled is not None:
        updates["TTS_ENABLED"] = str(req.tts_enabled)

    # Write to .env
    for key, value in updates.items():
        set_key(str(env_path), key, value)

    # Force os.environ update so pydantic-settings re-reads them
    for key, value in updates.items():
        os.environ[key] = value

    # Hot-reload: replace the module-level settings instance
    new_settings = config_module.Settings()
    config_module.settings = new_settings

    # Fix: properly update the settings reference in this module
    global settings
    settings = new_settings  # so get_settings() reads fresh values immediately

    # Propagate updated settings to other modules for true hot-reload
    try:
        import app.services.llm_service as _llm_svc
        _llm_svc.settings = new_settings
    except Exception:
        pass
    try:
        import app.agents.research_agent as _research_ag
        _research_ag.settings = new_settings
    except Exception:
        pass

    logger.info(f"Settings updated and reloaded: {list(updates.keys())}")
    return {"ok": True, "updated": list(updates.keys())}
