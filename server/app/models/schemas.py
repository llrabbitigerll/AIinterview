"""
Pydantic models for the AI Interview Server.
These map to the WebSocket protocol and internal data structures.

V1.1 — Interview Flow Specification with:
- P/T/C question types with probabilistic follow-up & switching
- Wall-clock based timing & C-question trigger
- Post-interview density evaluation
- Multi-round information transfer
"""
from __future__ import annotations

from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


# ── Research Brief ───────────────────────────────────────────

class ResearchBrief(BaseModel):
    """Result of company intelligence pre-research."""
    interview_id: str
    company: str
    business_unit: str
    position_type: str
    status: str = "pending"  # pending | phase1 | phase2 | phase3 | completed | failed
    error: Optional[str] = None
    summary: str = ""          # ~800 tokens, injected into system prompts
    full_report: str = ""      # complete markdown, saved to file
    phase1_data: Optional[dict] = None
    phase2_data: Optional[dict] = None
    phase3_data: Optional[dict] = None
    created_at: float = 0.0


# ── Enums ────────────────────────────────────────────────────

class QuestionType(str, Enum):
    """V1.1 §3.1 — Three question types."""
    P = "project_drill"       # 项目深挖（支持追问）
    T = "general_tech"        # 常规技术（单题无追问）
    C = "coding"              # 手撕代码

class InterviewMode(str, Enum):
    PROJECT = "project"       # 项目深挖模式 (P)
    GENERAL = "general"       # 常规技术模式 (T)
    CODING = "coding"         # 手撕代码模式 (C)
    QA_SESSION = "qa_session" # 反问环节
    # NOTE: PRESSURE mode removed in V1.1 — replaced by P/T/C type system

class AgentRole(str, Enum):
    AGENT_A = "agent_a"  # Orchestrator / Clock
    AGENT_B = "agent_b"  # Technical interviewer
    AGENT_C = "agent_c"  # Business / Behavioral interviewer

class AnswerQuality(str, Enum):
    EXCELLENT = "excellent"
    GOOD = "good"
    AVERAGE = "average"
    POOR = "poor"

class CodingQuality(str, Enum):
    """V1.1 §6 — C question quality grade."""
    EXCELLENT = "excellent"   # 优秀
    PASS = "pass"             # 合格
    FAIL = "fail"             # 不通过

class DensityVerdict(str, Enum):
    """V1.1 §5.2 — Post-interview density verdict."""
    SUFFICIENT = "sufficient"           # 密度充足
    INSUFFICIENT = "insufficient"       # 密度不够
    VETO = "veto"                       # 一票否决（>15 min gap）


# ── Resume Models ────────────────────────────────────────────

class CandidateProfile(BaseModel):
    name: str = ""
    years_exp: str = ""
    education: str = ""
    current_role: str = ""
    skill_tags: list[str] = Field(default_factory=list)

class ProjectInfo(BaseModel):
    index: int
    name: str
    role: str = ""
    duration: str = ""
    tech_stack: list[str] = Field(default_factory=list)
    key_metrics: dict[str, str] = Field(default_factory=dict)
    business_context: str = ""
    technical_highlights: list[str] = Field(default_factory=list)
    suspicious_points: list[str] = Field(default_factory=list)
    drill_suggestions: list[str] = Field(default_factory=list)

class StructuredResume(BaseModel):
    candidate_profile: CandidateProfile = Field(default_factory=CandidateProfile)
    projects: list[ProjectInfo] = Field(default_factory=list)
    career_trajectory: str = ""
    red_flags: list[str] = Field(default_factory=list)
    interview_focus: list[str] = Field(default_factory=list)
    interview_cheat_sheet: str = ""


# ── Interview Config ─────────────────────────────────────────

class InterviewConfig(BaseModel):
    interview_id: str
    company: str
    business_unit: str
    bu_key: str = ""                    # Layer 3 BU knowledge file key
    team: Optional[str] = ""             # Optional, Layer 3 granularity is BU-level
    position_type: str                   # "backend" | "frontend"
    target_level: str = "T3"             # T1~T6, candidate's target level
    round: int = 1                       # 1, 2, or 3
    resume: StructuredResume = Field(default_factory=StructuredResume)


# ── V1.1 Question-level tracking ────────────────────────────

class QuestionRecord(BaseModel):
    """Per-question timing & metadata for density evaluation."""
    question_index: int                  # 0-based global question index
    question_type: QuestionType          # P / T / C
    project_index: Optional[int] = None  # Which project (for P type)
    followup_depth: int = 0              # 0 = first question, 1-3 = followup depth
    topic: str = ""                      # e.g. "TCP 握手" for T, project name for P
    asked_at: float = 0.0               # wall-clock timestamp when question was asked
    answered_at: float = 0.0            # wall-clock timestamp when answer was received
    duration_seconds: float = 0.0       # answered_at - asked_at
    overtime: bool = False               # exceeded timeout threshold?
    overtime_tag: str = ""               # "回答冗长" if overtime


class EvaluationMemoryItem(BaseModel):
    """Per-question lightweight evaluation memory written during interview."""
    question_id: str
    question_index: int
    question_type: QuestionType
    question_text: str = ""
    answer_text: str = ""
    project_context: list[dict] = Field(default_factory=list)

    quality_score_5: int = 3
    quality_score_10_raw: float = 5.0
    rubric_scores: dict[str, int] = Field(default_factory=dict)
    key_defects: list[str] = Field(default_factory=list)
    follow_up_hints: list[str] = Field(default_factory=list)
    live_judgment: str = ""

    fluency_tag: str = "normal"  # normal | warning | critical
    fluency_metrics: dict = Field(default_factory=dict)
    duration_seconds: float = 0.0
    thinking_time_to_first_word_seconds: float = 0.0
    thinking_time_silence_seconds: float = 0.0
    created_at: float = 0.0


class ProjectDrillRecord(BaseModel):
    """Tracks how deeply each project has been drilled."""
    project_index: int
    project_name: str
    max_followup_depth: int = 0          # highest followup depth reached
    directions_explored: list[str] = Field(default_factory=list)


# ── V1.1 Multi-round transfer payload ───────────────────────

class RoundTransferData(BaseModel):
    """V1.1 §6 — Data passed between interview rounds."""
    asked_projects: list[ProjectDrillRecord] = Field(default_factory=list)
    asked_t_topics: list[str] = Field(default_factory=list)
    density_score: DensityVerdict = DensityVerdict.SUFFICIENT
    coding_result: Optional[dict] = None  # {"had_coding": bool, "quality": CodingQuality}
    total_questions: int = 0
    round: int = 1


# ── Blackboard (shared state between agents) ─────────────────

class Evaluation(BaseModel):
    """Background evaluation from the non-active agent."""
    evaluator: AgentRole
    round_number: int
    score: Optional[float] = None
    notes: str = ""
    ready: bool = False

class BlackboardState(BaseModel):
    """Central blackboard — the single source of truth.

    V1.1: Refactored for P/T/C type system with probabilistic switching.
    """
    # Interview configuration
    config: InterviewConfig

    # Level routing (derived from level_config.yaml at session init)
    interviewer_level: str = "T3"          # Current round's interviewer level
    is_double_agent_mode: bool = False     # True = dual-agent (B+C), False = single (B only)

    # Conversation history
    messages: list[dict] = Field(default_factory=list)  # {role, content, timestamp}

    # ── V1.1 State Machine (P/T/C) ──────────────────────────
    current_mode: InterviewMode = InterviewMode.PROJECT
    current_question_type: QuestionType = QuestionType.P

    # P-type (project drill) state
    current_project_index: Optional[int] = None   # which project is being drilled
    p_followup_count: int = 0                      # followup depth within current P series (0-3)
    projects_drilled: list[ProjectDrillRecord] = Field(default_factory=list)

    # T-type (general tech) state
    consecutive_t_count: int = 0                   # V1.1 §3.4 连续T计数器
    asked_t_topics: list[str] = Field(default_factory=list)

    # C-type (coding) state
    coding_triggered: bool = False                 # has C been triggered this session?
    coding_judgement_done: bool = False             # has the 40-min judgement been performed?
    coding_judgement_result: Optional[bool] = None  # True=trigger, False=skip, None=not judged
    coding_start_time: float = 0.0                 # when C question was issued
    coding_quality: Optional[CodingQuality] = None

    # ── Timing ───────────────────────────────────────────────
    interview_start_time: float = 0.0              # wall-clock start (epoch seconds)
    current_question_start_time: float = 0.0       # when current question was asked
    question_history: list[QuestionRecord] = Field(default_factory=list)

    # ── Legacy compat fields (kept for backward compat) ──────
    project_drill_count: int = 0                   # = p_followup_count alias
    general_tech_count: int = 0                    # total T questions (not consecutive)
    projects_asked: list[int] = Field(default_factory=list)
    general_areas_covered: list[str] = Field(default_factory=list)

    # Agent scheduling
    next_agent: AgentRole = AgentRole.AGENT_B
    total_questions: int = 0

    # B-C async evaluations (delayed read)
    evaluations: dict[int, Evaluation] = Field(default_factory=dict)

    # Per-question lightweight evaluation memory for post-interview report pipeline
    evaluation_memory: list[EvaluationMemoryItem] = Field(default_factory=list)

    # Fluency data from client
    latest_fluency: Optional[dict] = None

    # Persona fragments
    agent_b_system_prompt: str = ""
    agent_c_system_prompt: str = ""

    # Pre-research questions pool
    research_questions: list[str] = Field(default_factory=list)

    # Research brief (injected from company intelligence research)
    research_brief_summary: str = ""  # ~800 tokens, injected into agent system prompts

    # ── V1.1 Multi-round data ────────────────────────────────
    previous_round_data: Optional[RoundTransferData] = None

    # ── V1.1 Time limits (derived from round) ───────────────
    @property
    def time_limit_minutes(self) -> int:
        """V1.1 §1: 一面/二面 60分钟, 三面 70分钟"""
        return 70 if self.config.round == 3 else 60

    @property
    def elapsed_minutes(self) -> float:
        """Wall-clock minutes since interview start."""
        import time as _time
        if self.interview_start_time <= 0:
            return 0.0
        return (_time.time() - self.interview_start_time) / 60.0

    @property
    def is_projects_exhausted(self) -> bool:
        """V1.1 §3.4 项目枯竭: all resume projects fully drilled."""
        total_projects = len(self.config.resume.projects)
        if total_projects == 0:
            return True
        drilled_indices = {d.project_index for d in self.projects_drilled}
        return len(drilled_indices) >= total_projects

    @property
    def coding_allowed(self) -> bool:
        """V1.1 §3.2: 一面禁止C, 二面最多1道, 三面至少1道"""
        round_num = self.config.round
        if round_num == 1:
            return False
        if round_num == 2:
            return not self.coding_triggered
        # Round 3: always allowed
        return True


# ── Agent A Decision ─────────────────────────────────────────

class GateDecision(BaseModel):
    """Output of Agent A (Orchestrator). V1.1 updated."""
    action: str = "pass"         # "pass" | "intervene"
    next_agent: AgentRole = AgentRole.AGENT_B
    next_mode: InterviewMode = InterviewMode.PROJECT
    question_type: str = ""      # "project_drill" | "project_followup" | "new_project" | "general_tech" | "coding"
    target_project: Optional[int] = None
    tech_area: Optional[str] = None
    reasoning: str = ""
    intervention_message: Optional[str] = None  # only when action="intervene"
    is_followup: bool = False    # True if this is a P-type followup question
    followup_depth: int = 0      # current followup depth (0 = initial)


# ── ASR Result ───────────────────────────────────────────────

class WordTimestamp(BaseModel):
    word: str
    start_ms: int
    end_ms: int

class ASRResult(BaseModel):
    text: str
    words: list[WordTimestamp] = Field(default_factory=list)
    is_final: bool = False
    language: str = "zh-CN"
