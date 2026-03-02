"""
DevTools Spy — Runtime Monkey-Patch injection.

Call install_patches() ONCE after importing app modules.
Does NOT modify any source file. All original behavior is preserved.
"""
from __future__ import annotations

import asyncio
import functools
import logging
import time
from typing import AsyncIterator, Any

logger = logging.getLogger("devtools.spy")

# Installed flag — prevent double-patching
_PATCHES_INSTALLED = False


def install_patches() -> None:
    """
    Install all DevTools patches into already-imported app modules.
    Must be called AFTER `import app.*` but BEFORE uvicorn starts serving.
    """
    global _PATCHES_INSTALLED
    if _PATCHES_INSTALLED:
        logger.warning("DevTools patches already installed — skipping")
        return

    _patch_llm_service()
    _patch_orchestrator()
    _patch_session_manager()
    _patch_research_agent()
    _install_log_handler()

    _PATCHES_INSTALLED = True
    logger.info("✅ DevTools: all patches installed")


# ─────────────────────────────────────────────────────────────
#  1. LLM Service — llm_complete + llm_stream
# ─────────────────────────────────────────────────────────────

def _patch_llm_service() -> None:
    import app.services.llm_service as llm_mod
    from devtools.server.event_bus import bus, E

    _orig_complete = llm_mod.llm_complete
    _orig_stream = llm_mod.llm_stream

    async def _patched_complete(
        messages, model=None, temperature=0.7, max_tokens=1024, enable_search=False,
        module=None,
    ) -> str:
        call_id = f"llm-{int(time.time()*1000)}"
        bus.publish(E.LLM_CALL_START, {
            "call_id": call_id,
            "call_type": "complete",
            "model": model,
            "module": module,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "enable_search": enable_search,
            "messages": messages,
            "messages_count": len(messages),
            "system_chars": sum(len(m["content"]) for m in messages if m.get("role") == "system"),
        })
        t0 = time.perf_counter()
        try:
            result = await _orig_complete(messages, model, temperature, max_tokens, enable_search, module=module)
            elapsed = time.perf_counter() - t0
            bus.publish(E.LLM_CALL_END, {
                "call_id": call_id,
                "call_type": "complete",
                "model": model,
                "module": module,
                "elapsed_ms": round(elapsed * 1000),
                "response_chars": len(result),
                "response_preview": result[:500],
                "response_full": result,
                "success": True,
            })
            return result
        except Exception as exc:
            elapsed = time.perf_counter() - t0
            bus.publish(E.LLM_CALL_END, {
                "call_id": call_id,
                "call_type": "complete",
                "model": model,
                "module": module,
                "elapsed_ms": round(elapsed * 1000),
                "success": False,
                "error": str(exc),
            })
            raise

    async def _patched_stream(
        messages, model=None, temperature=0.7, max_tokens=1024, module=None,
    ) -> AsyncIterator[str]:
        call_id = f"llm-stream-{int(time.time()*1000)}"
        bus.publish(E.LLM_STREAM_START, {
            "call_id": call_id,
            "model": model,
            "module": module,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "messages": messages,
            "messages_count": len(messages),
        })
        t0 = time.perf_counter()
        tokens_collected: list[str] = []
        try:
            async for token in _orig_stream(messages, model, temperature, max_tokens, module=module):
                tokens_collected.append(token)
                yield token
            elapsed = time.perf_counter() - t0
            full_text = "".join(tokens_collected)
            bus.publish(E.LLM_STREAM_END, {
                "call_id": call_id,
                "model": model,
                "module": module,
                "elapsed_ms": round(elapsed * 1000),
                "token_count": len(tokens_collected),
                "response_chars": len(full_text),
                "response_preview": full_text[:500],
                "response_full": full_text,
                "success": True,
            })
        except Exception as exc:
            elapsed = time.perf_counter() - t0
            bus.publish(E.LLM_STREAM_END, {
                "call_id": call_id,
                "model": model,
                "module": module,
                "elapsed_ms": round(elapsed * 1000),
                "success": False,
                "error": str(exc),
            })
            raise

    llm_mod.llm_complete = _patched_complete
    llm_mod.llm_stream = _patched_stream

    # ── 关键修复：from...import 会在导入时绑定原始引用，
    #   替换模块属性对那些绑定无效，必须逐个补 patch ─────────
    import app.agents.interview_agent as _ia
    _ia.llm_complete = _patched_complete
    _ia.llm_stream   = _patched_stream

    import app.agents.orchestrator as _oa
    _oa.llm_complete = _patched_complete

    import app.agents.resume_agent as _ra
    _ra.llm_complete = _patched_complete

    import app.agents.research_agent as _rag
    _rag.llm_complete = _patched_complete

    import app.services.evaluation_engine as _ee
    _ee.llm_complete = _patched_complete

    # persona_builder / research_service 也可能调用 llm_complete
    try:
        import app.agents.persona_builder as _pb
        _pb.llm_complete = _patched_complete
    except (ImportError, AttributeError):
        pass
    try:
        import app.services.research_service as _rs
        _rs.llm_complete = _patched_complete
    except (ImportError, AttributeError):
        pass

    logger.info("DevTools: patched llm_service.llm_complete + llm_stream (+ all from-import bindings)")


# ─────────────────────────────────────────────────────────────
#  2. OrchestratorAgent.decide — capture GateDecision
# ─────────────────────────────────────────────────────────────

def _patch_orchestrator() -> None:
    from app.agents.orchestrator import OrchestratorAgent
    from devtools.server.event_bus import bus, E

    _orig_decide = OrchestratorAgent.decide

    async def _patched_decide(self, blackboard, user_text: str):
        result = await _orig_decide(self, blackboard, user_text)
        try:
            bus.publish(E.AGENT_DECISION, {
                "action": result.action,
                "next_agent": result.next_agent.value if result.next_agent else None,
                "next_mode": result.next_mode.value if result.next_mode else None,
                "question_type": result.question_type,
                "target_project": result.target_project,
                "tech_area": result.tech_area,
                "reasoning": result.reasoning,
                "is_followup": result.is_followup,
                "followup_depth": result.followup_depth,
                "intervention_message": result.intervention_message,
                # Blackboard snapshot at decision time
                "bb_total_questions": blackboard.total_questions,
                "bb_current_mode": blackboard.current_mode.value,
                "bb_p_followup_count": blackboard.p_followup_count,
                "bb_consecutive_t_count": blackboard.consecutive_t_count,
                "bb_elapsed_minutes": round(blackboard.elapsed_minutes, 1),
            })
        except Exception as e:
            logger.debug(f"DevTools spy error (decide): {e}")
        return result

    OrchestratorAgent.decide = _patched_decide
    logger.info("DevTools: patched OrchestratorAgent.decide")


# ─────────────────────────────────────────────────────────────
#  3. InterviewSession — _send_json, feed_audio, on_user_text,
#     _background_evaluate, _sync_state
# ─────────────────────────────────────────────────────────────

def _patch_session_manager() -> None:
    from app.services.session_manager import InterviewSession, SessionManager
    from devtools.server.event_bus import bus, E

    # ── 3a. _send_json — capture all S2C messages ────────────
    _orig_send_json = InterviewSession._send_json

    async def _patched_send_json(self, data: dict) -> None:
        try:
            msg_type = data.get("type", "unknown")
            # Don't publish tts_audio_chunk binary data in detail — just metadata
            if msg_type == "tts_audio_chunk":
                summary = {**data}
                audio = summary.pop("audio", "")
                summary["audio_bytes"] = len(audio) * 3 // 4  # base64 → approx bytes
                bus.publish(E.WS_S2C, summary, session_id=self.interview_id)
            else:
                bus.publish(E.WS_S2C, data, session_id=self.interview_id)
        except Exception as e:
            logger.debug(f"DevTools spy error (_send_json): {e}")
        await _orig_send_json(self, data)

    InterviewSession._send_json = _patched_send_json

    # ── 3b. feed_audio — capture binary frame sizes ──────────
    _orig_feed_audio = InterviewSession.feed_audio

    async def _patched_feed_audio(self, pcm_bytes: bytes) -> None:
        try:
            bus.publish(E.WS_BINARY, {
                "bytes": len(pcm_bytes),
                "duration_ms": round(len(pcm_bytes) / 32),  # 16kHz Int16 → 32 bytes/ms
            }, session_id=self.interview_id)
        except Exception as e:
            logger.debug(f"DevTools spy error (feed_audio): {e}")
        await _orig_feed_audio(self, pcm_bytes)

    InterviewSession.feed_audio = _patched_feed_audio

    # ── 3c. on_user_text — capture C2S text messages ─────────
    _orig_on_user_text = InterviewSession.on_user_text

    async def _patched_on_user_text(self, text: str, fluency_payload=None) -> None:
        try:
            bus.publish(E.WS_C2S, {
                "type": "text_input",
                "text": text,
                "fluency_payload": fluency_payload,
            }, session_id=self.interview_id)
        except Exception as e:
            logger.debug(f"DevTools spy error (on_user_text): {e}")
        await _orig_on_user_text(self, text, fluency_payload=fluency_payload)

    InterviewSession.on_user_text = _patched_on_user_text

    # ── 3d. _background_evaluate — capture eval results ──────
    _orig_bg_eval = InterviewSession._background_evaluate

    async def _patched_background_evaluate(
        self, agent, user_text, question_context, fluency_payload, project_context
    ) -> None:
        await _orig_bg_eval(
            self, agent, user_text, question_context, fluency_payload, project_context
        )
        try:
            # Read results from blackboard after evaluation completes
            round_num = self.blackboard.total_questions
            if self.blackboard.evaluation_memory:
                latest = self.blackboard.evaluation_memory[-1]
                bus.publish(E.EVAL_RESULT, {
                    "round_num": round_num,
                    "question_id": latest.question_id,
                    "question_index": latest.question_index,
                    "question_type": latest.question_type.value,
                    "question_text": latest.question_text[:300],
                    "answer_text": latest.answer_text[:300],
                    "quality_score_5": latest.quality_score_5,
                    "quality_score_10_raw": latest.quality_score_10_raw,
                    "rubric_scores": latest.rubric_scores,
                    "key_defects": latest.key_defects,
                    "follow_up_hints": latest.follow_up_hints,
                    "live_judgment": latest.live_judgment,
                    "fluency_tag": latest.fluency_tag,
                    "duration_seconds": latest.duration_seconds,
                    "thinking_time_to_first_word_seconds": latest.thinking_time_to_first_word_seconds,
                }, session_id=self.interview_id)
        except Exception as e:
            logger.debug(f"DevTools spy error (_background_evaluate): {e}")

    InterviewSession._background_evaluate = _patched_background_evaluate

    # ── 3e. _sync_state — capture blackboard snapshots ───────
    _orig_sync_state = InterviewSession._sync_state

    async def _patched_sync_state(self) -> None:
        await _orig_sync_state(self)
        try:
            bb = self.blackboard
            bus.publish(E.BLACKBOARD_SNAPSHOT, {
                "current_mode": bb.current_mode.value,
                "next_agent": bb.next_agent.value if bb.next_agent else None,
                "project_drill_count": bb.project_drill_count,
                "general_tech_count": bb.general_tech_count,
                "total_questions": bb.total_questions,
                "p_followup_count": bb.p_followup_count,
                "consecutive_t_count": bb.consecutive_t_count,
                "elapsed_minutes": round(bb.elapsed_minutes, 1),
                "time_limit_minutes": bb.time_limit_minutes,
                "coding_triggered": bb.coding_triggered,
                "round": bb.config.round,
                "is_double_agent_mode": bb.is_double_agent_mode,
                "interviewer_level": bb.interviewer_level,
                "messages_count": len(bb.messages),
                "evaluations_count": len(bb.evaluations),
            }, session_id=self.interview_id)
        except Exception as e:
            logger.debug(f"DevTools spy error (_sync_state): {e}")

    InterviewSession._sync_state = _patched_sync_state

    # ── 3f. SessionManager.create_session — capture session start
    _orig_create = SessionManager.create_session

    async def _patched_create_session(self, interview_id, config, ws) -> InterviewSession:
        session = await _orig_create(self, interview_id, config, ws)
        try:
            cfg = session.blackboard.config
            bus.publish(E.SESSION_START, {
                "interview_id": interview_id,
                "company": cfg.company,
                "business_unit": cfg.businessUnit,
                "round": cfg.round,
                "target_level": cfg.target_level,
                "position_type": cfg.positionType,
                "has_research": bool(session.blackboard.research_brief_summary),
            }, session_id=interview_id)
        except Exception as e:
            logger.debug(f"DevTools spy error (create_session): {e}")
        return session

    SessionManager.create_session = _patched_create_session

    logger.info("DevTools: patched InterviewSession._send_json, feed_audio, on_user_text, "
                "_background_evaluate, _sync_state + SessionManager.create_session")


# ─────────────────────────────────────────────────────────────
#  4. ResearchAgent — capture phase1/2/3/4 results
# ─────────────────────────────────────────────────────────────

def _patch_research_agent() -> None:
    try:
        from app.agents.research_agent import ResearchAgent
    except ImportError:
        logger.debug("DevTools: ResearchAgent not found, skipping patch")
        return

    from devtools.server.event_bus import bus, E

    for phase_num in [1, 2, 3, 4]:
        method_name = f"run_phase{phase_num}"
        if not hasattr(ResearchAgent, method_name):
            continue
        _orig = getattr(ResearchAgent, method_name)

        def _make_patched(orig, pnum):
            async def _patched(self, *args, **kwargs):
                bus.publish(E.RESEARCH_PHASE_START, {
                    "phase": pnum,
                    "interview_id": getattr(self, "interview_id", "unknown"),
                })
                t0 = time.perf_counter()
                try:
                    result = await orig(self, *args, **kwargs)
                    elapsed = time.perf_counter() - t0
                    bus.publish(E.RESEARCH_PHASE_END, {
                        "phase": pnum,
                        "interview_id": getattr(self, "interview_id", "unknown"),
                        "elapsed_ms": round(elapsed * 1000),
                        "success": True,
                        "result": result,
                    })
                    return result
                except Exception as exc:
                    elapsed = time.perf_counter() - t0
                    bus.publish(E.RESEARCH_PHASE_END, {
                        "phase": pnum,
                        "interview_id": getattr(self, "interview_id", "unknown"),
                        "elapsed_ms": round(elapsed * 1000),
                        "success": False,
                        "error": str(exc),
                    })
                    raise
            return _patched

        setattr(ResearchAgent, method_name, _make_patched(_orig, phase_num))

    logger.info("DevTools: patched ResearchAgent.run_phase1/2/3/4")


# ─────────────────────────────────────────────────────────────
#  5. Python Logging Handler — capture app.* log records
# ─────────────────────────────────────────────────────────────

class _DevToolsLogHandler(logging.Handler):
    """Captures log records from app.* and devtools.* namespaces."""

    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self._bus = None  # lazy import to avoid circular imports

    def emit(self, record: logging.LogRecord) -> None:
        try:
            if self._bus is None:
                from devtools.server.event_bus import bus
                self._bus = bus
            from devtools.server.event_bus import E
            self._bus.publish(E.LOG_RECORD, {
                "level": record.levelname,
                "logger": record.name,
                "message": self.format(record),
                "module": record.module,
                "funcName": record.funcName,
                "lineno": record.lineno,
            })
        except Exception:
            pass


def _install_log_handler() -> None:
    handler = _DevToolsLogHandler()
    handler.setFormatter(logging.Formatter("%(name)s: %(message)s"))

    # Attach to app root logger — captures all app.* subloggers
    app_logger = logging.getLogger("app")
    app_logger.addHandler(handler)

    devtools_logger = logging.getLogger("devtools")
    devtools_logger.addHandler(handler)

    logger.info("DevTools: installed log handler on app.* + devtools.*")
