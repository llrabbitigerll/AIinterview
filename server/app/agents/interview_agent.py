"""
Interview Agent — The speaking agents (B and C).
V1.1 — Updated instruction building for P/T/C question types.

Generates interview questions and responses based on:
- Their persona (from DynamicPersonaBuilder)
- Current blackboard state (mode, drill count, etc.)
- Gate decision from Agent A (question type, target area)
- Conversation history
- B-C sync buffer evaluations (if available)
- Pre-research Layer 4 intelligence (via system prompt)
"""
from __future__ import annotations

import logging
from typing import AsyncIterator

from app.models.schemas import (
    BlackboardState,
    GateDecision,
    AgentRole,
    InterviewMode,
)
from app.services.llm_service import llm_stream, llm_complete

from app.core.config import settings

logger = logging.getLogger(__name__)


class InterviewAgent:
    """
    A speaking interview agent (B = technical, C = business).
    Generates questions/responses through LLM with streaming.
    """

    def __init__(self, role: AgentRole, system_prompt: str):
        self.role = role
        self.system_prompt = system_prompt

    async def generate_response(
        self,
        blackboard: BlackboardState,
        gate_decision: GateDecision,
        user_text: str,
    ) -> AsyncIterator[str]:
        """
        Stream-generate the next interview question/response.
        Yields tokens as they arrive from the LLM.
        """
        messages = self._build_messages(blackboard, gate_decision, user_text)

        async for token in llm_stream(
            messages=messages,
            temperature=0.7,
            max_tokens=512,
            module="interview",
        ):
            yield token

    async def evaluate_answer(
        self,
        blackboard: BlackboardState,
        user_text: str,
        question_context: str,
        fluency_payload: dict | None = None,
        is_project_question: bool = False,
    ) -> dict:
        """
        Background evaluation of the user's answer (non-blocking).
        Used by the NON-active agent to evaluate asynchronously.
        Returns a brief assessment stored in B-C sync buffer.
        """
        fluency_hint = ""
        if fluency_payload:
            snapshot = fluency_payload.get("snapshot") or {}
            thinking = fluency_payload.get("thinking") or {}
            fluency_hint = (
                f"\n语音证据(辅助参考，不可喧宾夺主)："
                f"语速={snapshot.get('speechRate', 0)}，长停顿={snapshot.get('longPauseCount', 0)}，"
                f"填充词={snapshot.get('fillerCount', 0)}，"
                f"首词思考={thinking.get('toFirstWordSeconds', 0)}s，静默累计={thinking.get('silenceSeconds', 0)}s"
            )

        project_rule = "项目题额外判断：方案合理性、证据可信度、量化结果是否充分。" if is_project_question else ""

        eval_prompt = f"""你是面试评估专家。请输出“临场判断”用的结构化JSON，禁止输出多余文本。

问题：{question_context}
回答：{user_text[:1200]}
{fluency_hint}

评价维度：准确性、结构性、深度、证据。{project_rule}
要求：
1) quality_score_5 取值1-5（对外主评分）
2) quality_score_10_raw 取值1-10（内部原始分）
3) live_judgment 必须≤50字，客观、可执行
4) key_defects 与 follow_up_hints 各给1-3条短句
5) fluency_tag 只能是 normal/warning/critical

输出JSON：
{{
    "quality_score_5": 1-5,
    "quality_score_10_raw": 1-10,
    "rubric_scores": {{"accuracy": 1-5, "structure": 1-5, "depth": 1-5, "evidence": 1-5}},
    "key_defects": ["..."],
    "follow_up_hints": ["..."],
    "live_judgment": "不超过50字",
    "fluency_tag": "normal|warning|critical"
}}
"""
        try:
            response = await llm_complete(
                messages=[
                    {"role": "system", "content": "你是面试评估助手，输出严格JSON。"},
                    {"role": "user", "content": eval_prompt},
                ],
                temperature=0.3,
                max_tokens=150,
                module="eval",
            )
            import json
            parsed = json.loads(response.strip())
            return {
                "quality_score_5": int(parsed.get("quality_score_5", 3)),
                "quality_score_10_raw": float(parsed.get("quality_score_10_raw", 5.0)),
                "rubric_scores": parsed.get("rubric_scores", {}),
                "key_defects": parsed.get("key_defects", []),
                "follow_up_hints": parsed.get("follow_up_hints", []),
                "live_judgment": str(parsed.get("live_judgment", ""))[:50],
                "fluency_tag": parsed.get("fluency_tag", "normal"),
            }
        except Exception as e:
            logger.warning(f"Background evaluation failed: {e}")
            return {
                "quality_score_5": 3,
                "quality_score_10_raw": 5.0,
                "rubric_scores": {"accuracy": 3, "structure": 3, "depth": 3, "evidence": 3},
                "key_defects": ["评估失败，建议人工复核"],
                "follow_up_hints": [],
                "live_judgment": "临场评估失败，建议复核",
                "fluency_tag": "normal",
            }

    def _build_messages(
        self,
        bb: BlackboardState,
        decision: GateDecision,
        user_text: str,
    ) -> list[dict]:
        """Build the LLM message array for question generation."""
        messages: list[dict] = []

        # System prompt (persona)
        messages.append({"role": "system", "content": self.system_prompt})

        # Instruction based on gate decision
        instruction = self._build_instruction(bb, decision)
        messages.append({"role": "system", "content": instruction})

        # Conversation history (last N turns to keep context window reasonable)
        MAX_HISTORY = 20
        for msg in bb.messages[-MAX_HISTORY:]:
            role = "assistant" if msg["role"] in ("agent_b", "agent_c") else "user"
            messages.append({"role": role, "content": msg["content"]})

        # Current user input
        if user_text.strip():
            messages.append({"role": "user", "content": user_text})

        # B-C sync buffer — include latest evaluation from the other agent
        eval_note = self._get_peer_evaluation(bb)
        if eval_note:
            messages.append({
                "role": "system",
                "content": f"[另一位面试官的观察] {eval_note}",
            })

        return messages

    def _build_instruction(self, bb: BlackboardState, decision: GateDecision) -> str:
        """Build mode-specific instructions for the agent. V1.1 P/T/C types."""
        parts = [f"当前模式：{decision.next_mode.value}"]

        # ── Time awareness ───────────────────────────────────
        elapsed = bb.elapsed_minutes
        limit = bb.time_limit_minutes
        remaining = max(0, limit - elapsed)
        parts.append(f"已用时 {elapsed:.0f}/{limit} 分钟，剩余 {remaining:.0f} 分钟")

        # ── V1.1 §3.1 Question type instructions ────────────
        if decision.question_type in ("new_project", "project_drill"):
            project_idx = decision.target_project
            if project_idx is not None and project_idx < len(bb.config.resume.projects):
                project = bb.config.resume.projects[project_idx]
                parts.append(f"【P类·新项目】请直接针对项目「{project.name}」的技术方案提出具体问题")
                parts.append("不要让候选人自由介绍，直接切入技术选型原因、架构设计、遇到的挑战等具体问题")
                if project.drill_suggestions:
                    parts.append(f"建议深挖方向：{', '.join(project.drill_suggestions[:3])}")
            else:
                parts.append("【P类·项目深挖】请选择一个新项目并直接提出技术问题")

        elif decision.question_type == "project_followup":
            project_idx = decision.target_project
            depth = decision.followup_depth
            if project_idx is not None and project_idx < len(bb.config.resume.projects):
                project = bb.config.resume.projects[project_idx]
                parts.append(f"【P类·追问第{depth}层】继续深挖项目「{project.name}」")
                parts.append(f"基于候选人上一个回答的内容，进行更深层次的技术追问")
                parts.append(f"追问应具体聚焦，挖掘候选人在项目中的实际贡献和技术深度")
                max_remaining = 3 - depth
                if max_remaining > 0:
                    parts.append(f"剩余可追问次数：{max_remaining}")
                else:
                    parts.append("这是最后一次追问机会，问一个有深度的总结性问题")
            else:
                parts.append(f"【P类·追问第{depth}层】继续深挖当前项目")

        elif decision.question_type == "general_tech":
            if bb.current_mode == InterviewMode.PROJECT:
                # Transitioning from P to T
                parts.append("【P→T 切换】从项目深挖切换到常规技术考察")
                parts.append("请用自然的过渡话术，如：'聊得挺细的，我考你个基础问题...'")
            else:
                parts.append("【T类·常规技术】独立的技术知识单题，问完即结束，不设追问")
            if decision.tech_area:
                parts.append(f"技术领域：{decision.tech_area}")
            # Remind: avoid previously asked topics
            if bb.asked_t_topics:
                parts.append(f"已考察过的T类主题（避免重复）：{', '.join(bb.asked_t_topics[-5:])}")

        elif decision.question_type == "coding":
            parts.append("【C类·手撕代码】进入编码环节")
            parts.append("请给候选人出一道编程题，在回复中用标记 [CODE_CHALLENGE:题目名称] 开头")
            parts.append("题目要与候选人的技术栈和面试岗位相关")
            # Round-specific difficulty
            round_num = bb.config.round
            if round_num == 2:
                parts.append("难度：中等（二面C题）")
            elif round_num == 3:
                parts.append("难度：中等偏上（三面C题），可结合系统设计")
            # If previous round had coding, adjust
            if bb.previous_round_data and bb.previous_round_data.coding_result:
                prev_coding = bb.previous_round_data.coding_result
                if prev_coding.get("quality") == "excellent":
                    parts.append("上一面C题表现优秀，本面可适当提升难度")
                elif prev_coding.get("quality") == "fail":
                    parts.append("上一面C题表现不佳，本面可适当降低难度确保基础能力验证")

        elif decision.question_type == "qa_session":
            parts.append("【反问环节】候选人向你提问，请以面试官身份真实、有帮助地回答")
            parts.append("可以分享团队文化、技术栈、业务方向等信息")

        # ── V1.1 §6 Multi-round awareness ────────────────────
        if bb.previous_round_data:
            prev = bb.previous_round_data
            parts.append("")
            parts.append("【上一轮面试信息】")
            if prev.asked_t_topics:
                parts.append(f"已考察T类主题：{', '.join(prev.asked_t_topics[:8])}")
            if prev.asked_projects:
                proj_info = [f"{p.project_name}(深度{p.max_followup_depth})" for p in prev.asked_projects[:5]]
                parts.append(f"已深挖项目：{', '.join(proj_info)}")
            parts.append(f"上轮密度评估：{prev.density_score}")

        # ── General stats ────────────────────────────────────
        parts.append(f"\n本场面试已问{bb.total_questions}个问题")

        # ── Anti-topic-choice constraint ─────────────────────
        parts.append("")
        parts.append("【重要约束】你必须主动提出具体、有针对性的技术问题。"
                     "禁止让候选人选择话题或方向，不要说'你想聊哪个'、'你对哪方面感兴趣'、"
                     "'你觉得哪个项目更有挑战'之类的话。面试主导权在你手中。"
                     "如果候选人试图转移话题，礼貌但坚定地拉回当前考察方向。")

        return "\n".join(parts)

    def _get_peer_evaluation(self, bb: BlackboardState) -> str:
        """Get the latest evaluation from the peer agent."""
        # Find the most recent completed evaluation from the other agent
        for round_num in sorted(bb.evaluations.keys(), reverse=True):
            ev = bb.evaluations[round_num]
            if ev.ready and ev.evaluator != self.role:
                return f"评分{ev.score}/10 - {ev.notes}"
        return ""
