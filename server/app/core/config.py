"""
AI Interview Server — Configuration
"""
from pydantic_settings import BaseSettings
from typing import Optional, Literal


class Settings(BaseSettings):
    """Application settings, loaded from environment or .env file."""

    # ── Server ──────────────────────────────────────────────
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = True

    # ── LLM Provider API Keys & Base URLs ───────────────────
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: Optional[str] = None

    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-4-20250514"

    # Alibaba Qwen
    QWEN_API_KEY: str = ""
    QWEN_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"

    # Moonshot Kimi
    MOONSHOT_API_KEY: str = ""
    MOONSHOT_BASE_URL: str = "https://api.moonshot.cn/v1"

    # ── Per-Provider Strong/Fast Model Names ─────────────────
    openai_model_strong: str = "gpt-4o"
    openai_model_fast: str = "gpt-4o-mini"
    qwen_model_strong: str = "qwen-max"
    qwen_model_fast: str = "qwen-flash"
    moonshot_model_strong: str = "kimi-k2.5"
    moonshot_model_fast: str = "kimi-k2.5"

    # ── Per-Module LLM Configuration ─────────────────────────
    # 简历解析 AI
    RESUME_LLM_PROVIDER: str = "qwen"       # qwen | moonshot
    RESUME_LLM_MODEL: str = "qwen-max"

    # 面试官 AI (generate_response — streaming)
    INTERVIEW_LLM_PROVIDER: str = "qwen"    # qwen | moonshot
    INTERVIEW_LLM_MODEL: str = "qwen-max"

    # 调研 AI (ResearchAgent phases 1-4)
    RESEARCH_LLM_PROVIDER: str = "qwen"     # qwen | moonshot
    RESEARCH_LLM_MODEL: str = "qwen-max"

    # 评估 AI (evaluate_answer + OrchestratorAgent + EvaluationEngine)
    EVAL_LLM_PROVIDER: str = "qwen"         # qwen | moonshot
    EVAL_LLM_MODEL: str = "qwen-flash"

    # Legacy global provider (kept for fallback / test scripts)
    LLM_PROVIDER: str = "qwen"              # default provider if module not specified
    LLM_FALLBACK_PROVIDERS: list[str] = []

    # ── TTS ─────────────────────────────────────────────────
    TTS_ENABLED: bool = True
    TTS_MODEL: str = "qwen3-tts-flash"      # TTS model (uses QWEN_API_KEY)
    TTS_VOICE_AGENT_B: str = "Ethan"        # 晨煦 — 阳光活力男声 (双 Agent B)
    TTS_VOICE_AGENT_C: str = "Kai"          # 凯   — 磁性舒服男声 (双 Agent C)
    TTS_VOICE_SINGLE: str = "Kai"           # 单 Agent 模式固定音色

    # ── ASR — iFlytek (科大讯飞) only ───────────────────────
    ASR_PROVIDER: str = "iflytek"           # fixed: iflytek
    IFLYTEK_APP_ID: str = ""
    IFLYTEK_API_KEY: str = ""
    IFLYTEK_API_SECRET: str = ""
    IFLYTEK_ASR_URL: str = "wss://office-api-ast-dx.iflyaisol.com/"

    # ── Storage ─────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/interview"

    # ── Paths ───────────────────────────────────────────────
    KNOWLEDGE_DIR: str = "./app/knowledge"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    # ── Helpers ──────────────────────────────────────────────

    def get_module_provider(self, module: str) -> str:
        """Return the LLM provider for a given module name."""
        mapping = {
            "resume": self.RESUME_LLM_PROVIDER,
            "interview": self.INTERVIEW_LLM_PROVIDER,
            "research": self.RESEARCH_LLM_PROVIDER,
            "eval": self.EVAL_LLM_PROVIDER,
        }
        return mapping.get(module, self.LLM_PROVIDER)

    def get_module_model(self, module: str) -> str:
        """Return the LLM model for a given module name."""
        mapping = {
            "resume": self.RESUME_LLM_MODEL,
            "interview": self.INTERVIEW_LLM_MODEL,
            "research": self.RESEARCH_LLM_MODEL,
            "eval": self.EVAL_LLM_MODEL,
        }
        return mapping.get(module, "")


settings = Settings()
