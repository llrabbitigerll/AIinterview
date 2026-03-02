"""
Session Manager — Orchestrates a single interview session.
V1.1 — Full interview flow specification implementation.

Each session ties together:
- WebSocket connection to the client
- ASR provider (Azure / iFlytek)
- Three agents (A: orchestrator, B: tech, C: business)
- Central blackboard state (single source of truth)
- Wall-clock timing for C-trigger and time boundaries
- Post-interview evaluation engine

Flow per user utterance:
  1. Client sends PCM audio → ASR provider
  2. ASR returns transcription → send to client
  3. On speech_end / text input:
     a. Record answer timing and overtime check
     b. Agent A gate decision (V1.1 P/T/C state machine)
     c. Active agent (B or C) streams response
     d. Non-active agent runs background evaluation
     e. Update blackboard state (P-followup, T-counter, etc.)
     f. Sync state to client
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Optional

from fastapi import WebSocket

from app.models.schemas import (
    BlackboardState,
    InterviewConfig,
    InterviewMode,
    QuestionType,
    AgentRole,
    Evaluation,
    StructuredResume,
    ASRResult,
    QuestionRecord,
    ProjectDrillRecord,
    RoundTransferData,
    EvaluationMemoryItem,
)
from app.agents.orchestrator import OrchestratorAgent, ROUND2_C_TRIGGER_MINUTE
from app.agents.interview_agent import InterviewAgent
from app.agents.persona_builder import DynamicPersonaBuilder
from app.providers.asr_factory import create_asr_provider
from app.providers.asr_base import ASRProvider
from app.services.research_service import research_service
from app.services.evaluation_engine import EvaluationEngine
from app.services import tts_service
from app.services.tts_service import _SENTENCE_PUNCT, MIN_CHUNK_CHARS, MAX_CHUNK_CHARS

logger = logging.getLogger(__name__)


class InterviewSession:
    """Manages the full lifecycle of one interview session. V1.1."""

    def __init__(
        self,
        interview_id: str,
        config: InterviewConfig,
        ws: WebSocket,
    ):
        self.interview_id = interview_id
        self.ws = ws
        self.seq = 0

        # ── Blackboard (single source of truth) ──
        self.blackboard = BlackboardState(config=config)

        # ── Agents ──
        self.agent_a = OrchestratorAgent()
        self.agent_b: Optional[InterviewAgent] = None
        self.agent_c: Optional[InterviewAgent] = None

        # ── Evaluation Engine (V1.1) ──
        self.evaluator = EvaluationEngine()

        # ── ASR ──
        self.asr: Optional[ASRProvider] = None
        self._asr_buffer: str = ""  # Current partial transcription
        self._asr_final_event: asyncio.Event = asyncio.Event()

        # ── Background tasks ──
        self._bg_tasks: list[asyncio.Task] = []
        self._is_active = True

        # ── V1.1 Timing ──
        self._round2_c_check_done = False  # Has the 40-min check been performed?

    async def initialize(self) -> None:
        """Set up agents, ASR, and send the first question."""
        config = self.blackboard.config

        # 1. Build personas via three-layer merge
        persona_builder = DynamicPersonaBuilder()
        self._persona_builder = persona_builder  # keep ref for orchestrator

        # Derive interviewer_level and is_double_agent_mode from level_config
        level_cfg = persona_builder.get_level_config()
        round_rules = level_cfg.get("round_rules", {})
        target_rules = round_rules.get(config.target_level, [])
        current_round = config.round

        interviewer_level = config.target_level  # fallback
        is_double = False
        for rule in target_rules:
            if rule.get("round") == current_round:
                interviewer_level = rule.get("interviewer_level", config.target_level)
                is_double = rule.get("mode", "single") == "double"
                break

        self.blackboard.interviewer_level = interviewer_level
        self.blackboard.is_double_agent_mode = is_double

        logger.info(
            f"Session init: target={config.target_level} round={current_round} "
            f"→ interviewer={interviewer_level} double={is_double}"
        )

        # Build Agent B prompt (always present)
        b_prompt = persona_builder.build(
            config,
            interviewer_level=interviewer_level,
            agent_role="agent_b",
            research_brief_summary=self.blackboard.research_brief_summary,
        )
        self.blackboard.agent_b_system_prompt = b_prompt
        self.agent_b = InterviewAgent(AgentRole.AGENT_B, b_prompt)

        # Build Agent C prompt only in double-agent mode
        if is_double:
            c_prompt = persona_builder.build(
                config,
                interviewer_level=interviewer_level,
                agent_role="agent_c",
                research_brief_summary=self.blackboard.research_brief_summary,
            )
            self.blackboard.agent_c_system_prompt = c_prompt
            self.agent_c = InterviewAgent(AgentRole.AGENT_C, c_prompt)

        # 2. Start ASR asynchronously — do NOT block interview initialization.
        # If ASR fails, the session degrades to text-only mode gracefully.
        self._asr_warning: str | None = None
        self.asr = create_asr_provider()
        # Fire-and-forget: ASR init runs in background, session proceeds immediately
        self._bg_tasks.append(asyncio.create_task(self._init_asr_async()))

        # 3. Send interview_ready to client immediately (ASR status sent later)
        agents_info: dict = {
            "agentB": {
                "displayName": f"{config.company}技术面试官（{interviewer_level}）",
                "persona": "技术深度考察",
            },
        }
        if is_double:
            agents_info["agentC"] = {
                "displayName": f"{config.company}业务/战略面试官（{interviewer_level}）",
                "persona": "业务理解与战略视野",
            }

        opening_text = self._generate_opening()

        await self._send_json({
            "type": "interview_ready",
            "interviewId": self.interview_id,
            "agents": agents_info,
            "isDoubleAgentMode": is_double,
            "interviewerLevel": interviewer_level,
            "firstQuestion": opening_text,
            "firstAgent": "agent_b",
            "seq": self._next_seq(),
        })

        # Set initial state
        self.blackboard.next_agent = AgentRole.AGENT_B
        self.blackboard.current_mode = InterviewMode.PROJECT

        # V1.1: Record wall-clock start time
        self.blackboard.interview_start_time = time.time()

        opening_text = self._generate_opening()

        # Record opening message
        self.blackboard.messages.append({
            "role": "agent_b",
            "content": opening_text,
            "timestamp": time.time(),
        })

        # Fire TTS for opening question in background (sends tts_start/chunk/done after ready)
        from app.core.config import settings as _settings
        if _settings.TTS_ENABLED:
            opening_voice = (
                _settings.TTS_VOICE_AGENT_B if is_double else _settings.TTS_VOICE_SINGLE
            )
            self._bg_tasks.append(asyncio.create_task(
                self._send_opening_tts(opening_text, opening_voice)
            ))

    def _generate_opening(self) -> str:
        """Generate the opening question."""
        resume = self.blackboard.config.resume
        if resume.projects:
            first_project = resume.projects[0]
            return (
                f"你好！我先看了你的简历，注意到你做过「{first_project.name}」这个项目。"
                f"能先简单介绍一下这个项目的背景和你在其中的角色吗？"
            )
        return "你好！请先简单做个自我介绍，重点聊聊你最近做的技术项目。"

    async def _send_opening_tts(self, text: str, voice: str) -> None:
        """Synthesize and stream TTS for the opening question to the client."""
        import base64
        logger.info(f"[TTS] Opening: synthesizing {len(text)} chars with voice={voice}")
        try:
            wav_bytes = await tts_service.synthesize(text, voice)
        except Exception as exc:
            logger.warning(f"[TTS] Opening synthesis failed: {exc}")
            return
        if not wav_bytes:
            logger.warning("[TTS] Opening synthesis returned no audio")
            return
        logger.info(f"[TTS] Opening: got {len(wav_bytes)} bytes, sending to client")
        await self._send_json({
            "type": "tts_start",
            "agent": "agent_b",
            "seq": self._next_seq(),
        })
        audio_b64 = base64.b64encode(wav_bytes).decode("utf-8")
        await self._send_json({
            "type": "tts_audio_chunk",
            "audio": audio_b64,
            "seq": self._next_seq(),
        })
        await self._send_json({
            "type": "tts_done",
            "seq": self._next_seq(),
        })
        logger.info("[TTS] Opening: tts_done sent to client")
        # After TTS, ensure ASR is still alive (it may have timed out during TTS silence)
        await self._ensure_asr_alive()

    # ── Audio handling ───────────────────────────────────────

    async def _init_asr_async(self) -> None:
        """Initialize ASR in background. Sends asr_status to client when done."""
        try:
            await self.asr.start_stream(self._on_asr_result)
            logger.info("ASR initialized successfully")
            await self._send_json({
                "type": "asr_status",
                "available": True,
                "seq": self._next_seq(),
            })
        except Exception as asr_exc:
            error_msg = str(asr_exc)
            logger.error(f"ASR init failed, falling back to text-only mode: {error_msg}")
            self._asr_warning = error_msg
            self.asr = None
            await self._send_json({
                "type": "asr_status",
                "available": False,
                "warning": error_msg,
                "seq": self._next_seq(),
            })

    async def feed_audio(self, pcm_bytes: bytes) -> None:
        """Forward PCM audio to ASR provider."""
        if self.asr and self._is_active:
            await self.asr.feed_audio(pcm_bytes)

    async def _on_asr_result(self, result: ASRResult) -> None:
        """Callback from ASR provider with transcription result."""
        # Send transcription to client
        await self._send_json({
            "type": "transcription",
            "text": result.text,
            "words": [
                {
                    "word": w.word,
                    "startMs": w.start_ms,
                    "endMs": w.end_ms,
                }
                for w in result.words
            ],
            "isFinal": result.is_final,
            "seq": self._next_seq(),
        })

        if result.is_final:
            self._asr_buffer = result.text
            self._asr_final_event.set()  # Notify on_speech_end that final result is ready

    # ── User interaction ─────────────────────────────────────

    async def on_tts_playback_done(self) -> None:
        """Called when the client finishes playing TTS audio and the mic is active.

        This is the correct moment to ensure ASR is alive — NOT when tts_done was
        sent (before playback) because the iFlytek connection may still be open then
        but could time-out during the remaining playback seconds.
        We force a restart so the user's next speech is always transcribed correctly.
        """
        logger.info("[ASR] tts_playback_done received — re-checking ASR connection")
        await self._ensure_asr_alive(force=True)

    async def on_speech_end(self) -> None:
        """Called when client signals end of speech (VAD or manual 'answer end' button).

        This method flushes the ASR buffer and sends the final transcription to the client,
        but does NOT trigger the LLM pipeline. The LLM is only triggered when the user
        explicitly submits text via on_user_text() (i.e., clicks the send button).
        This implements the manual-confirm flow: speak → review text → send.
        """
        # Reset the event so we can wait for the *next* final result if buffer is empty
        self._asr_final_event.clear()

        # If no final ASR result has arrived yet (network latency), wait up to 2 s
        if not self._asr_buffer.strip():
            try:
                await asyncio.wait_for(self._asr_final_event.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                logger.warning(
                    "on_speech_end: timed out waiting for ASR final result, discarding utterance"
                )

        # Clear the buffer — the transcription was already sent to the client via
        # _on_asr_result(). The client will display it in the input box for review.
        # LLM processing happens only when the user confirms via on_user_text().
        self._asr_buffer = ""

    async def on_user_text(self, text: str, fluency_payload: Optional[dict] = None) -> None:
        """Called when user sends text input (confirmed via send button)."""
        await self._process_user_input(text, fluency_payload)

    async def _process_user_input(self, user_text: str, fluency_payload: Optional[dict] = None) -> None:
        """
        Core pipeline: user input → Agent A gate → Agent B/C response.
        V1.1: Includes timing, P/T/C state tracking, C-trigger, overtime check.

        Flow:
        1. Record user message on blackboard
        2. Record answer timing for the PREVIOUS question (§5.1)
        3. Check round-2 40-minute C-trigger (§3.2)
        4. Agent A gate decision (V1.1 state machine)
        5. Stream response from active agent
        6. Update V1.1 blackboard state
        7. Kick off background evaluation
        8. Sync state to client
        """
        now = time.time()

        # 1. Record on blackboard
        self.blackboard.messages.append({
            "role": "user",
            "content": user_text,
            "timestamp": now,
        })

        # 2. Record timing for the previous question (if any)
        self._record_answer_timing(now)

        # Capture the question the user is currently answering BEFORE the next
        # question is generated and appended to messages / question_history.
        # If captured later, _get_last_question_text() and question_history[-1]
        # would both return the *next* question, producing the Q2-topic + A1-text
        # mismatch seen in per-question feedback reports.
        _current_question_context = self._get_last_question_text()
        _current_answered_q = (
            self.blackboard.question_history[-1]
            if self.blackboard.question_history
            else None
        )

        # 3. V1.1 §3.2: Round-2 40-minute C-trigger check
        self._check_round2_c_trigger()

        # 4. Agent A gate decision
        decision = await self.agent_a.decide(self.blackboard, user_text)
        logger.info(
            f"Agent A decision: {decision.action} → {decision.next_agent.value} "
            f"mode={decision.next_mode.value} type={decision.question_type} "
            f"followup={decision.is_followup} depth={decision.followup_depth} "
            f"| {decision.reasoning}"
        )

        # Handle intervention — special case for time boundary or QA end
        if decision.action == "intervene" and decision.intervention_message:
            await self._send_agent_message(
                AgentRole.AGENT_A, decision.intervention_message
            )
            if (self.blackboard.current_mode == InterviewMode.QA_SESSION
                    or "时间已到" in (decision.intervention_message or "")):
                await self.end()
            return

        # Detect QA session transition
        prev_mode = self.blackboard.current_mode
        entering_qa = (
            decision.next_mode == InterviewMode.QA_SESSION
            and prev_mode != InterviewMode.QA_SESSION
        )

        # 5. Update blackboard state BEFORE generating response
        self._update_blackboard_state_v11(decision)

        # 6. Determine active agent
        active_agent = self.agent_b if decision.next_agent == AgentRole.AGENT_B else self.agent_c
        inactive_agent = (
            self.agent_c if decision.next_agent == AgentRole.AGENT_B else self.agent_b
        ) if self.blackboard.is_double_agent_mode else None

        if not active_agent:
            if decision.next_agent == AgentRole.AGENT_C and self.agent_b:
                active_agent = self.agent_b
                decision.next_agent = AgentRole.AGENT_B
                logger.warning("Agent C requested in single-agent mode, falling back to Agent B")
            else:
                logger.error("Active agent is None")
                return

        # 7. Determine TTS voice for this agent
        from app.core.config import settings as _settings
        if self.blackboard.is_double_agent_mode:
            tts_voice = (
                _settings.TTS_VOICE_AGENT_B
                if decision.next_agent == AgentRole.AGENT_B
                else _settings.TTS_VOICE_AGENT_C
            )
        else:
            tts_voice = _settings.TTS_VOICE_SINGLE

        # 8. Stream response from active agent; simultaneously dispatch TTS tasks per chunk
        full_response = ""
        question_start = time.time()
        tts_buffer = ""          # accumulates tokens until a chunk boundary
        tts_tasks: list[asyncio.Task] = []  # ordered list of TTS futures

        async for token in active_agent.generate_response(
            self.blackboard, decision, user_text
        ):
            full_response += token
            tts_buffer += token

            # Send text token to client immediately (unaffected by TTS)
            await self._send_json({
                "type": "agent_response",
                "agent": decision.next_agent.value,
                "content": token,
                "isComplete": False,
                "seq": self._next_seq(),
            })

            # ── TTS chunking logic ───────────────────────────
            if len(tts_buffer) >= MAX_CHUNK_CHARS:
                # Force-flush: too long without punctuation
                chunk = tts_buffer.strip()
                tts_buffer = ""
                if chunk and _settings.TTS_ENABLED:
                    tts_tasks.append(asyncio.create_task(
                        tts_service.synthesize(chunk, tts_voice)
                    ))
            elif _SENTENCE_PUNCT.search(token):
                if len(tts_buffer) > MIN_CHUNK_CHARS:
                    # Normal sentence boundary flush
                    chunk = tts_buffer.strip()
                    tts_buffer = ""
                    if chunk and _settings.TTS_ENABLED:
                        tts_tasks.append(asyncio.create_task(
                            tts_service.synthesize(chunk, tts_voice)
                        ))
                # else: ≤ MIN_CHUNK_CHARS — keep buffer, merge with next segment

        # Flush any remaining text after LLM finishes
        if tts_buffer.strip() and _settings.TTS_ENABLED:
            tts_tasks.append(asyncio.create_task(
                tts_service.synthesize(tts_buffer.strip(), tts_voice)
            ))

        # Send LLM completion marker
        await self._send_json({
            "type": "agent_response",
            "agent": decision.next_agent.value,
            "content": "",
            "isComplete": True,
            "seq": self._next_seq(),
        })

        # 8b. Stream TTS audio chunks to client in order
        if tts_tasks and _settings.TTS_ENABLED:
            await self._send_json({
                "type": "tts_start",
                "agent": decision.next_agent.value,
                "seq": self._next_seq(),
            })
            import base64
            for task in tts_tasks:
                try:
                    wav_bytes = await task
                    if wav_bytes:
                        audio_b64 = base64.b64encode(wav_bytes).decode("utf-8")
                        await self._send_json({
                            "type": "tts_audio_chunk",
                            "audio": audio_b64,
                            "seq": self._next_seq(),
                        })
                except Exception as exc:
                    logger.warning(f"[TTS] chunk failed, skipping: {exc}")
            await self._send_json({
                "type": "tts_done",
                "seq": self._next_seq(),
            })
            # After TTS completes, ensure ASR is still alive.
            # The client suspends its mic during TTS, so the ASR WebSocket may
            # have timed out from inactivity.  Restart it if needed so the
            # candidate’s next speech is properly recognised.
            await self._ensure_asr_alive()

        # Record agent message on blackboard
        self.blackboard.messages.append({
            "role": decision.next_agent.value,
            "content": full_response,
            "timestamp": time.time(),
        })
        self.blackboard.total_questions += 1

        # Record this question's start time for next answer timing calculation
        self.blackboard.current_question_start_time = time.time()

        # Record question metadata in history
        q_type = self._decision_to_question_type(decision)
        topic = self._extract_topic(decision, full_response)
        self.blackboard.question_history.append(QuestionRecord(
            question_index=self.blackboard.total_questions - 1,
            question_type=q_type,
            project_index=decision.target_project,
            followup_depth=decision.followup_depth if decision.is_followup else 0,
            topic=topic,
            asked_at=question_start,
            # answered_at will be filled when user responds
        ))

        # Track T-type topics
        if q_type == QuestionType.T and topic:
            self.blackboard.asked_t_topics.append(topic)

        # ── QA Session entry notification ──
        if entering_qa:
            await self._send_json({
                "type": "qa_session",
                "message": "面试的提问环节已结束。现在你可以向面试官提出你的问题，比如关于团队、技术栈、业务方向等。",
                "seq": self._next_seq(),
            })
            logger.info("Entered QA session — candidate can now ask questions")

        # ── Code challenge detection ──
        code_match = re.search(
            r"\[CODE_CHALLENGE(?::([^\]]*))?\]", full_response
        )
        if code_match:
            challenge_hint = code_match.group(1) or ""
            challenge_desc = full_response[:code_match.start()].strip()
            await self._send_json({
                "type": "code_challenge",
                "title": challenge_hint or "编程题",
                "description": challenge_desc,
                "seq": self._next_seq(),
            })
            logger.info(f"Code challenge detected: {challenge_hint}")
            self.blackboard.coding_triggered = True
            self.blackboard.coding_start_time = time.time()

        # 8. Background evaluation (single-agent uses active interviewer; double-agent uses non-active)
        evaluator_agent = inactive_agent or active_agent
        if evaluator_agent:
            task = asyncio.create_task(
                self._background_evaluate(
                    evaluator_agent,
                    user_text,
                    _current_question_context,
                    fluency_payload,
                    self._extract_project_context_for_current_answer(),
                    _current_answered_q,
                )
            )
            self._bg_tasks.append(task)

        # 9. Sync state to client
        await self._sync_state()

    def _update_blackboard_state_v11(self, decision) -> None:
        """
        V1.1 — Update blackboard based on gate decision.
        Handles P-followup depth, T-consecutive counter, and project tracking.
        """
        prev_mode = self.blackboard.current_mode
        self.blackboard.current_mode = decision.next_mode
        self.blackboard.next_agent = decision.next_agent

        # ── Transitioning to PROJECT mode ────────────────────
        if decision.next_mode == InterviewMode.PROJECT:
            if decision.question_type == "new_project" and decision.target_project is not None:
                # New project: reset followup counter, record project
                self.blackboard.current_project_index = decision.target_project
                self.blackboard.p_followup_count = 0
                self.blackboard.projects_asked.append(decision.target_project)
                self.blackboard.project_drill_count = 1

                # Ensure project is in drilled list
                if not any(d.project_index == decision.target_project for d in self.blackboard.projects_drilled):
                    proj_name = ""
                    if decision.target_project < len(self.blackboard.config.resume.projects):
                        proj_name = self.blackboard.config.resume.projects[decision.target_project].name
                    self.blackboard.projects_drilled.append(ProjectDrillRecord(
                        project_index=decision.target_project,
                        project_name=proj_name,
                    ))

            elif decision.question_type == "project_followup":
                # P-type followup: increment depth
                self.blackboard.p_followup_count = decision.followup_depth
                self.blackboard.project_drill_count = decision.followup_depth + 1

                # Update max depth in drill record
                for d in self.blackboard.projects_drilled:
                    if d.project_index == self.blackboard.current_project_index:
                        d.max_followup_depth = max(d.max_followup_depth, decision.followup_depth)
                        break

            # Reset T-consecutive counter when entering P mode (§3.4)
            self.blackboard.consecutive_t_count = 0

        # ── Transitioning to GENERAL mode ────────────────────
        elif decision.next_mode == InterviewMode.GENERAL:
            # Increment T counters
            self.blackboard.consecutive_t_count += 1
            self.blackboard.general_tech_count += 1

            if decision.tech_area and decision.tech_area not in self.blackboard.general_areas_covered:
                self.blackboard.general_areas_covered.append(decision.tech_area)

            # Reset P-followup counter when leaving P mode
            if prev_mode == InterviewMode.PROJECT:
                self.blackboard.p_followup_count = 0
                self.blackboard.project_drill_count = 0

        # ── Transitioning to CODING mode ─────────────────────
        elif decision.next_mode == InterviewMode.CODING:
            self.blackboard.current_question_type = QuestionType.C
            # Reset counters
            self.blackboard.consecutive_t_count = 0
            self.blackboard.p_followup_count = 0

        # ── QA Session ───────────────────────────────────────
        elif decision.next_mode == InterviewMode.QA_SESSION:
            pass

    # ── V1.1 Timing & Recording Helpers ──────────────────────

    def _record_answer_timing(self, now: float) -> None:
        """
        Record timing for the previous question's answer.
        V1.1 §5.1: Check overtime and tag if needed.
        """
        if not self.blackboard.question_history:
            return

        last_q = self.blackboard.question_history[-1]
        if last_q.answered_at > 0:
            return  # Already recorded

        last_q.answered_at = now
        last_q.duration_seconds = now - last_q.asked_at

        # Check overtime
        overtime, tag = self.evaluator.check_answer_overtime(
            last_q.question_type, last_q.duration_seconds
        )
        last_q.overtime = overtime
        last_q.overtime_tag = tag

        if overtime:
            logger.info(
                f"Answer overtime: Q{last_q.question_index} type={last_q.question_type.value} "
                f"duration={last_q.duration_seconds/60:.1f}min → '{tag}'"
            )

    def _check_round2_c_trigger(self) -> None:
        """
        V1.1 §3.2 — Check if round-2 40-minute C-trigger should fire.
        Called each time user sends input.
        """
        bb = self.blackboard
        if bb.config.round != 2:
            return
        if self._round2_c_check_done:
            return
        if bb.elapsed_minutes >= ROUND2_C_TRIGGER_MINUTE:
            self._round2_c_check_done = True
            self.agent_a.check_round2_coding_trigger(bb)

    def _decision_to_question_type(self, decision) -> QuestionType:
        """Map gate decision to QuestionType enum."""
        if decision.question_type in ("new_project", "project_drill", "project_followup"):
            return QuestionType.P
        elif decision.question_type == "general_tech":
            return QuestionType.T
        elif decision.question_type == "coding":
            return QuestionType.C
        return QuestionType.T  # default fallback

    def _extract_topic(self, decision, response: str) -> str:
        """Extract a topic label for the question."""
        if decision.question_type in ("new_project", "project_drill", "project_followup"):
            if decision.target_project is not None and decision.target_project < len(self.blackboard.config.resume.projects):
                return self.blackboard.config.resume.projects[decision.target_project].name
        elif decision.tech_area:
            return decision.tech_area
        # Fallback: first 20 chars of response
        return response[:20].strip() if response else ""

    def _get_last_question_text(self) -> str:
        """Return latest interviewer question text before current user answer."""
        for msg in reversed(self.blackboard.messages):
            if msg.get("role") in ("agent_b", "agent_c"):
                return str(msg.get("content", ""))
        return ""

    def _extract_project_context_for_current_answer(self) -> list[dict]:
        """For project questions, return the current project QA chain context only."""
        project_idx = self.blackboard.current_project_index
        if project_idx is None:
            return []

        target_name = ""
        if project_idx < len(self.blackboard.config.resume.projects):
            target_name = self.blackboard.config.resume.projects[project_idx].name

        if not target_name:
            return []

        context: list[dict] = []
        for msg in self.blackboard.messages:
            content = str(msg.get("content", ""))
            if target_name in content:
                context.append({
                    "role": msg.get("role", ""),
                    "content": content,
                    "timestamp": msg.get("timestamp", 0),
                })
        return context

    def _derive_fluency_tag(self, fluency_payload: Optional[dict]) -> str:
        """Derive normal/warning/critical from client fluency snapshot and details."""
        if not fluency_payload:
            return "normal"

        snapshot = fluency_payload.get("snapshot") or {}
        details = fluency_payload.get("details") or {}
        word_gaps = details.get("wordGaps") or {}

        confirmed = len(word_gaps.get("confirmedMs") or [])
        long_gaps = len(word_gaps.get("longMs") or [])
        filler_count = int(snapshot.get("fillerCount") or 0)
        total_words = sum(int(v) for v in (snapshot.get("fillerBreakdown") or {}).values())
        filler_density = 0.0
        if total_words > 0:
            filler_density = filler_count / total_words

        disfluency_cluster_hits = min(confirmed, filler_count) + long_gaps
        if disfluency_cluster_hits >= 2 or long_gaps >= 2:
            return "critical"
        if confirmed >= 2 or filler_density >= 0.05:
            return "warning"
        return "normal"

    async def _background_evaluate(
        self,
        agent: InterviewAgent,
        user_text: str,
        question_context: str,
        fluency_payload: Optional[dict],
        project_context: list[dict],
        answered_question_record=None,
    ) -> None:
        """Run background evaluation (non-blocking)."""
        try:
            result = await agent.evaluate_answer(
                self.blackboard,
                user_text,
                question_context,
                fluency_payload=fluency_payload,
                is_project_question=bool(project_context),
            )
            round_num = self.blackboard.total_questions
            self.blackboard.evaluations[round_num] = Evaluation(
                evaluator=agent.role,
                round_number=round_num,
                score=result.get("quality_score_10_raw"),
                notes=result.get("live_judgment", ""),
                ready=True,
            )

            # Use the question record captured BEFORE next question was generated,
            # avoiding the stale question_history[-1] pointing to Q(n+1).
            answered_q = answered_question_record
            fluency_tag = self._derive_fluency_tag(fluency_payload)
            if answered_q:
                self.blackboard.evaluation_memory.append(EvaluationMemoryItem(
                    question_id=f"Q{answered_q.question_index + 1}-{answered_q.topic or answered_q.question_type.value}",
                    question_index=answered_q.question_index,
                    question_type=answered_q.question_type,
                    question_text=question_context,
                    answer_text=user_text,
                    project_context=project_context,
                    quality_score_5=int(result.get("quality_score_5", 3)),
                    quality_score_10_raw=float(result.get("quality_score_10_raw", 5.0)),
                    rubric_scores=result.get("rubric_scores", {}),
                    key_defects=result.get("key_defects", []),
                    follow_up_hints=result.get("follow_up_hints", []),
                    live_judgment=result.get("live_judgment", ""),
                    fluency_tag=fluency_tag,
                    fluency_metrics=fluency_payload or {},
                    duration_seconds=float(answered_q.duration_seconds or 0),
                    thinking_time_to_first_word_seconds=float(((fluency_payload or {}).get("thinking") or {}).get("toFirstWordSeconds") or 0),
                    thinking_time_silence_seconds=float(((fluency_payload or {}).get("thinking") or {}).get("silenceSeconds") or 0),
                    created_at=time.time(),
                ))

            logger.info(
                f"Background eval done: round={round_num} score5={result.get('quality_score_5')} fluency={fluency_tag}"
            )
        except Exception as e:
            logger.warning(f"Background evaluation error: {e}")

    # ── Agent message helper ─────────────────────────────────

    async def _send_agent_message(self, agent: AgentRole, message: str) -> None:
        """Send a complete (non-streamed) message from an agent."""
        await self._send_json({
            "type": "agent_response",
            "agent": agent.value,
            "content": message,
            "isComplete": True,
            "seq": self._next_seq(),
        })
        self.blackboard.messages.append({
            "role": agent.value,
            "content": message,
            "timestamp": time.time(),
        })

    # ── Control ──────────────────────────────────────────────

    async def pause(self) -> None:
        """Pause the session."""
        if self.asr:
            await self.asr.stop_stream()
        self._is_active = False

    async def resume(self) -> None:
        """Resume the session."""
        if self.asr:
            await self.asr.start_stream(self._on_asr_result)
        self._is_active = True

    async def end(self) -> None:
        """End the interview and send V1.1 evaluation report."""
        self._is_active = False

        # Wait for background tasks
        for task in self._bg_tasks:
            if not task.done():
                task.cancel()

        # Record final answer timing
        self._record_answer_timing(time.time())

        # V1.1: Generate comprehensive evaluation report
        report = await self.evaluator.generate_report(self.blackboard)

        await self._send_json({
            "type": "interview_end",
            "reportJson": json.dumps(report, ensure_ascii=False),
            "seq": self._next_seq(),
        })

        logger.info(
            f"Interview ended: round={self.blackboard.config.round} "
            f"questions={self.blackboard.total_questions} "
            f"density={report.get('density_verdict', 'unknown')} "
            f"duration={report.get('total_duration_minutes', 0):.1f}min"
        )

        await self.cleanup()

    async def cleanup(self) -> None:
        """Release all resources."""
        if self.asr:
            await self.asr.close()
        for task in self._bg_tasks:
            if not task.done():
                task.cancel()

    async def _ensure_asr_alive(self, *, force: bool = False) -> None:
        """Check whether the ASR stream is still connected; restart it if not.

        Called after every TTS session because the client suspends its
        microphone during TTS playback, leaving the ASR WebSocket silent
        for potentially 10–60 s.  Some providers (iFlytek RTASR) close the
        connection after ~30 s of inactivity, silently killing transcription
        for the rest of the interview.

        Args:
            force: When True, always restart ASR even if it appears alive.
                   Used when called from on_tts_playback_done() where we know
                   the full TTS audio has played and we need a guaranteed-fresh
                   ASR connection for the user's next speech.
        """
        if not self._is_active:
            return

        asr_ok = self.asr is not None and self.asr.is_alive
        if asr_ok and not force:
            logger.debug("[ASR] Health check passed after TTS")
            return

        if asr_ok and force:
            logger.info("[ASR] Force-restarting ASR after tts_playback_done")
        else:
            logger.warning("[ASR] Stream dead after TTS — restarting...")
        # Close the existing (dead) provider gracefully
        if self.asr:
            try:
                await self.asr.close()
            except Exception:
                pass
            self.asr = None

        # Spin up a fresh provider
        try:
            from app.providers.asr_factory import create_asr_provider
            self.asr = create_asr_provider()
            await self.asr.start_stream(self._on_asr_result)
            logger.info("[ASR] Restarted successfully after TTS gap")
            # Notify client that ASR is back
            await self._send_json({
                "type": "asr_status",
                "available": True,
                "seq": self._next_seq(),
            })
        except Exception as exc:
            logger.error(f"[ASR] Restart failed after TTS gap: {exc}")
            self.asr = None
            await self._send_json({
                "type": "asr_status",
                "available": False,
                "warning": str(exc),
                "seq": self._next_seq(),
            })

    # ── State sync ───────────────────────────────────────────

    async def _sync_state(self) -> None:
        """Send blackboard state snapshot to client. V1.1 extended fields."""
        bb = self.blackboard
        await self._send_json({
            "type": "state_sync",
            "blackboard": {
                "currentMode": bb.current_mode.value,
                "nextAgent": bb.next_agent.value,
                "projectDrillCount": bb.project_drill_count,
                "generalTechCount": bb.general_tech_count,
                "totalQuestions": bb.total_questions,
                # V1.1 fields
                "pFollowupCount": bb.p_followup_count,
                "consecutiveTCount": bb.consecutive_t_count,
                "elapsedMinutes": round(bb.elapsed_minutes, 1),
                "timeLimitMinutes": bb.time_limit_minutes,
                "codingTriggered": bb.coding_triggered,
                "round": bb.config.round,
            },
            "seq": self._next_seq(),
        })

    # ── Transport helpers ────────────────────────────────────

    async def _send_json(self, data: dict) -> None:
        try:
            await self.ws.send_json(data)
        except Exception as e:
            logger.warning(f"Failed to send to client: {e}")

    def _next_seq(self) -> int:
        self.seq += 1
        return self.seq


class SessionManager:
    """Manages all active interview sessions."""

    def __init__(self):
        self._sessions: dict[str, InterviewSession] = {}

    async def create_session(
        self,
        interview_id: str,
        config: dict,
        ws: WebSocket,
    ) -> InterviewSession:
        """Create and initialize a new interview session. V1.1."""
        # Parse config
        resume_data = config.get("resumeJson", "{}")
        try:
            resume_dict = json.loads(resume_data) if isinstance(resume_data, str) else resume_data
            resume = StructuredResume(**resume_dict)
        except Exception:
            resume = StructuredResume()

        ic = InterviewConfig(
            interview_id=interview_id,
            company=config.get("company", ""),
            business_unit=config.get("businessUnit", ""),
            bu_key=config.get("buKey", ""),
            team=config.get("team", ""),
            position_type=config.get("positionType", "backend"),
            target_level=config.get("targetLevel", "T3"),
            round=config.get("round", 1),
            resume=resume,
        )

        session = InterviewSession(interview_id, ic, ws)

        # Inject research brief if available (from pre-interview research)
        research_summary = research_service.get_summary_for_prompt(interview_id)
        if research_summary:
            session.blackboard.research_brief_summary = research_summary
            logger.info(f"[SessionManager] Research brief injected for {interview_id} ({len(research_summary)} chars)")
        else:
            logger.info(f"[SessionManager] No research brief available for {interview_id}")

        # V1.1 §6: Inject previous round data if available
        prev_round_data = config.get("previousRoundData")
        if prev_round_data:
            try:
                if isinstance(prev_round_data, str):
                    prev_round_data = json.loads(prev_round_data)
                session.blackboard.previous_round_data = RoundTransferData(**prev_round_data)
                logger.info(
                    f"[SessionManager] Previous round data injected for {interview_id} "
                    f"(round {prev_round_data.get('round', '?')})"
                )
            except Exception as e:
                logger.warning(f"[SessionManager] Failed to parse previous round data: {e}")

        await session.initialize()
        self._sessions[interview_id] = session
        return session

    async def remove_session(self, interview_id: str) -> None:
        session = self._sessions.pop(interview_id, None)
        if session:
            await session.cleanup()

    def get_session(self, interview_id: str) -> Optional[InterviewSession]:
        return self._sessions.get(interview_id)
