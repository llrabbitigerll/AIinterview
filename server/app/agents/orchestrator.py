"""
Agent A — Orchestrator / Clock / Gate Controller.
V1.1 — Implements the full interview flow specification.

Core responsibilities:
1. P/T/C question type state machine with probabilistic switching
2. P-type follow-up mechanism (max 3, probability decay: 80%/40%/0%)
3. T-type consecutive counter with callback to P
4. C-type trigger logic (round-specific rules)
5. Wall-clock time boundary enforcement
6. Project exhaustion handling
"""
from __future__ import annotations

import json
import logging
import random
import time
from typing import Optional

from app.models.schemas import (
    BlackboardState,
    GateDecision,
    InterviewMode,
    QuestionType,
    AgentRole,
    AnswerQuality,
)
from app.services.llm_service import llm_complete

logger = logging.getLogger(__name__)

# ── V1.1 Probability Tables ─────────────────────────────────

# §3.3 P-type follow-up probabilities (continue_prob after Nth followup)
P_FOLLOWUP_CONTINUE_PROB = {
    1: 0.80,   # After 1st followup → 80% continue
    2: 0.40,   # After 2nd followup → 40% continue
    3: 0.00,   # After 3rd followup → 0% (forced stop)
}

# §3.4 T-type consecutive counter → callback to P probability
T_CALLBACK_TO_P_PROB = {
    2: 0.40,   # After 2nd consecutive T → 40% switch to P
    3: 0.60,   # After 3rd consecutive T → 60% switch to P
    4: 1.00,   # After 4th consecutive T → 100% forced switch to P
}

# §5.1 Answer timeout thresholds (minutes)
ANSWER_TIMEOUT = {
    QuestionType.P: 6,    # 项目深挖: 6 min timeout
    QuestionType.T: 3,    # 常规技术: 3 min timeout
    QuestionType.C: 25,   # 手撕代码: 25 min timeout
}

# §3.2 Round 2 C-question trigger time (minutes) and probability
ROUND2_C_TRIGGER_MINUTE = 40
ROUND2_C_TRIGGER_PROB = 0.20  # §8 待规范事项 #4: 参考值 20%


AGENT_A_SYSTEM_PROMPT = """你是面试流程控制器。根据当前面试状态，快速决策：

1. action: "pass"（绝大多数情况）或 "intervene"（仅当面试严重跑偏时）
2. next_agent: "agent_b" 或 "agent_c"
3. next_mode: "project" 或 "general" 或 "coding" 或 "qa_session"
4. question_type: "project_drill" | "project_followup" | "new_project" | "general_tech" | "coding"

重要：如果候选人试图主导话题或转移方向，应将action设为"pass"并继续当前考察方向。
输出严格JSON，不要解释：
{"action":"pass","next_agent":"agent_b","next_mode":"project","question_type":"project_drill","reasoning":"简短原因"}
"""


class OrchestratorAgent:
    """Agent A: V1.1 flow control with P/T/C state machine."""

    def __init__(self):
        # Pending C-trigger buffer: when round-2 40-min judgement fires
        # mid-question, store the result here. Consumed after current answer.
        self._pending_c_trigger: Optional[bool] = None

    async def decide(self, blackboard: BlackboardState, user_text: str) -> GateDecision:
        """
        Main entry point. Returns a GateDecision for the next question.

        Order of checks:
        1. Time boundary → end interview
        2. QA session handling
        3. Pending C-trigger (round 2, post-40-min judgement)
        4. Round-3 coding check
        5. Rule-based P/T/C state machine
        6. LLM intervention check (rare edge cases)
        """
        bb = blackboard

        # ── 1. Time boundary check ──────────────────────────
        time_decision = self._check_time_boundary(bb)
        if time_decision:
            return time_decision

        # ── 2. QA session ────────────────────────────────────
        if bb.current_mode == InterviewMode.QA_SESSION:
            return self._handle_qa_session(bb, user_text)

        # ── 3. Pending C-trigger from round-2 40-min judgement
        if self._pending_c_trigger is True and not bb.coding_triggered:
            self._pending_c_trigger = None
            return self._make_coding_decision(bb, "二面40分钟判定触发C题")

        # ── 4. Round-3 coding scheduling ─────────────────────
        if self.should_trigger_round3_coding(bb):
            return self._make_coding_decision(bb, "三面必含C题，时间已到调度点")

        # ── 5. Rule-based P/T/C state machine ───────────────
        rule_decision = self._apply_v11_rules(bb, user_text)

        # ── 6. LLM intervention check (rare) ────────────────
        if self._needs_llm_check(bb, user_text):
            llm_decision = await self._llm_check(bb, user_text)
            if llm_decision and llm_decision.action == "intervene":
                return llm_decision

        return rule_decision

    # ═══════════════════════════════════════════════════════════
    #  V1.1 Core State Machine
    # ═══════════════════════════════════════════════════════════

    def _apply_v11_rules(self, bb: BlackboardState, user_text: str) -> GateDecision:
        """
        V1.1 §3 — P/T/C state machine with probabilistic switching.

        State transitions:
        - P mode → follow-up (probabilistic) or terminate → T
        - T mode → consecutive counter → callback to P (probabilistic) or continue T
        - C mode → only via explicit trigger
        """
        # ── First question? Always start with P  ─────────────
        if bb.total_questions == 0:
            return self._start_first_project(bb)

        # ── Current mode: PROJECT (P-type series) ────────────
        if bb.current_mode == InterviewMode.PROJECT:
            return self._handle_p_mode(bb, user_text)

        # ── Current mode: GENERAL (T-type) ───────────────────
        elif bb.current_mode == InterviewMode.GENERAL:
            return self._handle_t_mode(bb, user_text)

        # ── Current mode: CODING (C-type) ────────────────────
        elif bb.current_mode == InterviewMode.CODING:
            return self._after_coding(bb)

        # Fallback
        return GateDecision(reasoning="fallback")

    def _handle_p_mode(self, bb: BlackboardState, user_text: str) -> GateDecision:
        """
        V1.1 §3.3 — P-type follow-up mechanism.

        After each P answer:
        - Check follow-up probability based on depth
        - If continue: depth+1, generate follow-up
        - If terminate: next question is ALWAYS T-type (§3.3)
        """
        depth = bb.p_followup_count  # how many followups completed so far

        # Check probability of continuing followup
        continue_prob = P_FOLLOWUP_CONTINUE_PROB.get(depth, 0.0)

        if depth < 3 and random.random() < continue_prob:
            # Continue follow-up on current project
            decision = GateDecision()
            decision.next_mode = InterviewMode.PROJECT
            decision.question_type = "project_followup"
            decision.is_followup = True
            decision.followup_depth = depth + 1
            decision.target_project = bb.current_project_index
            decision.reasoning = f"P类追问第{depth+1}次 (继续概率{continue_prob*100:.0f}%)"
            decision.next_agent = self._select_agent(bb)
            return decision
        else:
            # Terminate P series → next question MUST be T-type (§3.3)
            decision = GateDecision()
            decision.next_mode = InterviewMode.GENERAL
            decision.question_type = "general_tech"
            decision.tech_area = self._select_tech_area(bb)
            decision.reasoning = f"P类追问终止(深度{depth}) → 切换到T类"
            decision.next_agent = self._select_agent(bb)
            return decision

    def _handle_t_mode(self, bb: BlackboardState, user_text: str) -> GateDecision:
        """
        V1.1 §3.4 — T-type consecutive counter with callback to P.

        After each T answer:
        - consecutive_t_count already incremented by session_manager
        - Check callback probability based on count
        - If callback to P: select new project/direction
        - If continue T: select new topic
        - If projects exhausted: skip P logic, pure T+C
        """
        t_count = bb.consecutive_t_count

        # Check callback probability
        callback_prob = T_CALLBACK_TO_P_PROB.get(t_count, 0.0)

        # If projects exhausted → skip P callback (§3.4 项目枯竭处理)
        if bb.is_projects_exhausted:
            callback_prob = 0.0

        if callback_prob > 0 and random.random() < callback_prob:
            # Switch back to P-type
            next_project = self._select_next_project(bb)
            if next_project is not None:
                decision = GateDecision()
                decision.next_mode = InterviewMode.PROJECT
                decision.question_type = "new_project"
                decision.target_project = next_project
                decision.reasoning = f"连续{t_count}个T题后回调P(概率{callback_prob*100:.0f}%)"
                decision.next_agent = self._select_agent(bb)
                return decision
            # If no project available, fallthrough to continue T

        # Continue T-type
        decision = GateDecision()
        decision.next_mode = InterviewMode.GENERAL
        decision.question_type = "general_tech"
        decision.tech_area = self._select_tech_area(bb, exclude_covered=True)
        decision.reasoning = f"继续T类 (连续第{t_count + 1}题)"
        decision.next_agent = self._select_agent(bb)
        return decision

    def _after_coding(self, bb: BlackboardState) -> GateDecision:
        """After C-type finishes, return to P or T."""
        decision = GateDecision()
        if not bb.is_projects_exhausted:
            next_proj = self._select_next_project(bb)
            if next_proj is not None:
                decision.next_mode = InterviewMode.PROJECT
                decision.question_type = "new_project"
                decision.target_project = next_proj
                decision.reasoning = "C题完成，回到P类"
            else:
                decision.next_mode = InterviewMode.GENERAL
                decision.question_type = "general_tech"
                decision.tech_area = self._select_tech_area(bb)
                decision.reasoning = "C题完成，无可用项目，继续T类"
        else:
            decision.next_mode = InterviewMode.GENERAL
            decision.question_type = "general_tech"
            decision.tech_area = self._select_tech_area(bb)
            decision.reasoning = "C题完成，项目已枯竭，继续T类"
        decision.next_agent = self._select_agent(bb)
        return decision

    def _start_first_project(self, bb: BlackboardState) -> GateDecision:
        """Start the interview with the first project deep-dive."""
        decision = GateDecision()
        decision.next_mode = InterviewMode.PROJECT
        decision.next_agent = AgentRole.AGENT_B

        if bb.config.resume.projects:
            decision.question_type = "new_project"
            decision.target_project = 0
            decision.reasoning = "面试开始 → 第一个项目深挖"
        else:
            decision.question_type = "general_tech"
            decision.next_mode = InterviewMode.GENERAL
            decision.tech_area = self._select_tech_area(bb)
            decision.reasoning = "无项目简历 → 直接进入T类"
        return decision

    # ═══════════════════════════════════════════════════════════
    #  C-type (Coding) Trigger Logic
    # ═══════════════════════════════════════════════════════════

    def check_round2_coding_trigger(self, bb: BlackboardState) -> Optional[bool]:
        """
        V1.1 §3.2 — Round 2 C-question 40-minute one-shot judgement.

        Called by session_manager when wall-clock hits 40 minutes.
        Returns: True (trigger), False (no trigger), None (not applicable)
        """
        if bb.config.round != 2:
            return None
        if bb.coding_judgement_done:
            return None  # Already judged

        bb.coding_judgement_done = True
        result = random.random() < ROUND2_C_TRIGGER_PROB
        bb.coding_judgement_result = result

        if result:
            self._pending_c_trigger = True
            logger.info("Round 2: 40-min C-question judgement → TRIGGER")
        else:
            logger.info("Round 2: 40-min C-question judgement → NO TRIGGER")

        return result

    def should_trigger_round3_coding(self, bb: BlackboardState) -> bool:
        """
        V1.1 §3.2 — Round 3 must have at least 1 C question.

        Returns True if we should schedule C now.
        """
        if bb.config.round != 3:
            return False
        if bb.coding_triggered:
            return False
        # Flexible timing for round 3 — trigger around 50-70% progress
        elapsed = bb.elapsed_minutes
        limit = bb.time_limit_minutes
        if limit <= 0:
            return False
        progress = elapsed / limit
        # Trigger at 50% progress, or if < 25 min remaining
        remaining = limit - elapsed
        if progress >= 0.50 or remaining < 25:
            return True
        return False

    def _make_coding_decision(self, bb: BlackboardState, reason: str) -> GateDecision:
        """Create a GateDecision for C-type question."""
        decision = GateDecision()
        decision.next_mode = InterviewMode.CODING
        decision.question_type = "coding"
        decision.reasoning = reason
        decision.next_agent = self._select_agent(bb)
        return decision

    # ═══════════════════════════════════════════════════════════
    #  Time Boundary & QA Session
    # ═══════════════════════════════════════════════════════════

    def _check_time_boundary(self, bb: BlackboardState) -> Optional[GateDecision]:
        """
        V1.1 §1 — Time boundary enforcement.

        Questions must be asked within the time limit.
        If already past, do NOT ask a new question — end interview.
        """
        if bb.interview_start_time <= 0:
            return None  # Not started yet

        elapsed = bb.elapsed_minutes
        limit = bb.time_limit_minutes

        if elapsed >= limit:
            decision = GateDecision()
            decision.action = "intervene"
            decision.intervention_message = (
                f"本轮面试时间已到（{limit}分钟），感谢你的配合。"
                "我们会尽快整理评估结果反馈给你。"
            )
            decision.reasoning = f"时间边界: {elapsed:.1f}/{limit}分钟"
            return decision

        return None

    def _handle_qa_session(self, bb: BlackboardState, user_text: str) -> GateDecision:
        """Handle QA session mode."""
        decision = GateDecision()
        decision.next_mode = InterviewMode.QA_SESSION
        decision.next_agent = bb.next_agent
        decision.question_type = "qa_session"
        decision.reasoning = "反问环节继续"

        end_signals = ["没有了", "没问题了", "就这些", "暂时没有", "我没有问题"]
        if any(s in user_text for s in end_signals):
            decision.action = "intervene"
            decision.intervention_message = "好的，那今天的面试就到这里。谢谢你的参与，我们会尽快给你反馈。"
        return decision

    # ═══════════════════════════════════════════════════════════
    #  Agent Selection & Helpers
    # ═══════════════════════════════════════════════════════════

    def _select_agent(self, bb: BlackboardState) -> AgentRole:
        """Select which agent speaks next."""
        if not bb.is_double_agent_mode:
            return AgentRole.AGENT_B

        # In double-agent mode: rotate every 3 questions
        if bb.total_questions > 0 and bb.total_questions % 3 == 0:
            return (
                AgentRole.AGENT_C
                if bb.next_agent == AgentRole.AGENT_B
                else AgentRole.AGENT_B
            )
        return bb.next_agent

    def _assess_answer_quality(self, text: str) -> AnswerQuality:
        """Quick heuristic answer quality assessment (no LLM)."""
        if not text.strip():
            return AnswerQuality.POOR
        word_count = len(text)
        if word_count < 20:
            return AnswerQuality.POOR
        if word_count < 50:
            return AnswerQuality.AVERAGE
        return AnswerQuality.GOOD

    def _needs_llm_check(self, bb: BlackboardState, user_text: str) -> bool:
        """Determine if LLM intervention check is needed."""
        if bb.total_questions > 0 and bb.total_questions % 5 == 0:
            return True
        confused_signals = ["不太明白", "能再说一遍", "这个我不太了解", "跳过"]
        return any(s in user_text for s in confused_signals)

    async def _llm_check(
        self, bb: BlackboardState, user_text: str
    ) -> Optional[GateDecision]:
        """Use fast LLM to check if intervention is needed."""
        try:
            context = f"""当前面试状态：
- 模式：{bb.current_mode.value}
- 已问{bb.total_questions}题
- P类追问深度：{bb.p_followup_count}
- 连续T题数：{bb.consecutive_t_count}
- 已用时间：{bb.elapsed_minutes:.1f}/{bb.time_limit_minutes}分钟
- 候选人最新回答：{user_text[:200]}

判断是否需要干预（仅在面试严重跑偏时）。"""

            response = await llm_complete(
                messages=[
                    {"role": "system", "content": AGENT_A_SYSTEM_PROMPT},
                    {"role": "user", "content": context},
                ],
                temperature=0.1,
                max_tokens=150,
                module="eval",
            )

            decision_data = json.loads(response.strip())
            return GateDecision(**decision_data)
        except Exception as e:
            logger.warning(f"Agent A LLM check failed: {e}")
            return None

    # ── Tech area & project selection ────────────────────────

    def _select_tech_area(
        self, bb: BlackboardState, exclude_covered: bool = False
    ) -> str:
        """Select a tech area based on position type and BU knowledge."""
        position = bb.config.position_type

        bu_topics = self._get_bu_interview_topics(bb)

        if bu_topics:
            areas = bu_topics
        else:
            area_map: dict[str, list[str]] = {
                "backend": [
                    "高并发处理", "数据库优化", "缓存策略",
                    "系统监控", "API设计", "消息队列",
                    "微服务治理", "高可用设计", "容器化实践",
                    "性能调优", "分布式事务", "服务网格",
                ],
                "frontend": [
                    "性能优化", "状态管理", "组件设计",
                    "构建工具链", "跨端方案", "SSR/SSG",
                    "渲染性能", "前端工程化", "微前端",
                ],
            }
            areas = area_map.get(position, area_map["backend"])

        if exclude_covered:
            areas = [a for a in areas if a not in bb.general_areas_covered]
            areas = [a for a in areas if a not in bb.asked_t_topics]

        return random.choice(areas) if areas else "系统设计"

    def _get_bu_interview_topics(self, bb: BlackboardState) -> list[str]:
        """Try to read common_interview_topics from BU knowledge YAML."""
        try:
            from app.agents.persona_builder import DynamicPersonaBuilder
            builder = DynamicPersonaBuilder()
            company_key = builder._resolve_company_key(bb.config)
            bu_data = builder.get_bu_knowledge(
                company_key, bb.config.bu_key, bb.config.position_type
            )
            topics = bu_data.get("common_interview_topics", [])
            if topics:
                return topics
        except Exception as e:
            logger.warning(f"Failed to load BU interview topics: {e}")
        return []

    def _has_unasked_projects(self, bb: BlackboardState) -> bool:
        total = len(bb.config.resume.projects)
        drilled_indices = {d.project_index for d in bb.projects_drilled}
        return len(drilled_indices) < total

    def _select_next_project(self, bb: BlackboardState) -> Optional[int]:
        total = len(bb.config.resume.projects)
        drilled_indices = {d.project_index for d in bb.projects_drilled}
        available = [i for i in range(total) if i not in drilled_indices]
        return random.choice(available) if available else None
