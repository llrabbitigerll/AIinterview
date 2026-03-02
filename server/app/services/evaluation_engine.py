"""
V1.1 §5 — Evaluation Engine.

Post-interview evaluation system:
1. Non-code question density evaluation (§5.2)
2. Answer timeout tracking (§5.1)
3. C-question independent evaluation
4. Multi-round transfer data generation (§6)
"""
from __future__ import annotations

import json
import logging
import re
import statistics
from typing import Optional

from app.core.config import settings
from app.models.schemas import (
    BlackboardState,
    EvaluationMemoryItem,
    QuestionType,
    RoundTransferData,
    DensityVerdict,
)
from app.services.llm_service import llm_complete

logger = logging.getLogger(__name__)

# ── §5.2 Time baselines per question type ────────────────────
BASELINE_MINUTES = {
    QuestionType.P: 6,   # P类: 6 min/题 (含追问系列)
    QuestionType.T: 3,   # T类: 3 min/题
}

# Veto threshold: if gap > 15 min → veto
VETO_GAP_MINUTES = 15

FEEDBACK_LENGTH_RULES: dict[int, tuple[int, int]] = {
    5: (30, 50),
    4: (50, 80),
    3: (100, 150),
    2: (150, 200),
    1: (200, 300),
}

EFFICIENCY_BASELINE_SECONDS = {
    "knowledge": 10,
    "scenario": 20,
    "design": 45,
}


class EvaluationEngine:
    """
    V1.1 evaluation engine.

    Computes post-interview metrics and generates:
    - Density verdict
    - Per-question timing analysis
    - C-question quality assessment
    - Round transfer data for multi-round interviews
    """

    def evaluate_density(self, bb: BlackboardState) -> DensityVerdict:
        """
        V1.1 §5.2 — Non-code question density evaluation.

        Formula:
          non_code_expected = P_count × 6 + T_count × 3
          non_code_available = total_time - actual_C_time
          
        Verdict:
          available > expected → insufficient
          gap > 15 min → veto
          otherwise → sufficient
        """
        # Count P and T questions (unique series, not followups)
        p_series_count = 0
        t_count = 0
        total_c_time = 0.0

        for q in bb.question_history:
            if q.question_type == QuestionType.P and q.followup_depth == 0:
                p_series_count += 1
            elif q.question_type == QuestionType.T:
                t_count += 1
            elif q.question_type == QuestionType.C:
                total_c_time += q.duration_seconds / 60.0  # convert to minutes

        non_code_expected = p_series_count * BASELINE_MINUTES[QuestionType.P] + \
                           t_count * BASELINE_MINUTES[QuestionType.T]
        non_code_available = bb.time_limit_minutes - total_c_time

        gap = non_code_available - non_code_expected

        logger.info(
            f"Density eval: P×{p_series_count} + T×{t_count} = "
            f"expected {non_code_expected:.1f}min, "
            f"available {non_code_available:.1f}min, gap={gap:.1f}min"
        )

        if gap > VETO_GAP_MINUTES:
            return DensityVerdict.VETO
        elif gap > 0:
            return DensityVerdict.INSUFFICIENT
        else:
            return DensityVerdict.SUFFICIENT

    def evaluate_coding(self, bb: BlackboardState) -> Optional[dict]:
        """
        V1.1 §5.2 — C-question independent evaluation.

        Returns: {"had_coding": bool, "quality": str, "overtime": bool, "duration_min": float}
        """
        c_questions = [q for q in bb.question_history if q.question_type == QuestionType.C]

        if not c_questions:
            return {"had_coding": False, "quality": None, "overtime": False, "duration_min": 0}

        # Use the last C question (there should be at most 1 per round in round 2)
        c_q = c_questions[-1]
        duration_min = c_q.duration_seconds / 60.0
        overtime = duration_min > 25

        # Quality comes from LLM evaluation stored in blackboard.coding_quality
        quality = bb.coding_quality.value if bb.coding_quality else None

        return {
            "had_coding": True,
            "quality": quality,
            "overtime": overtime,
            "duration_min": round(duration_min, 1),
        }

    def check_answer_overtime(
        self, question_type: QuestionType, duration_seconds: float
    ) -> tuple[bool, str]:
        """
        V1.1 §5.1 — Check if an answer exceeded timeout threshold.

        Returns: (is_overtime, tag)
        """
        from app.agents.orchestrator import ANSWER_TIMEOUT

        threshold_min = ANSWER_TIMEOUT.get(question_type, 5)
        duration_min = duration_seconds / 60.0

        if duration_min > threshold_min:
            return True, "回答冗长"
        return False, ""

    def generate_round_transfer(self, bb: BlackboardState) -> RoundTransferData:
        """
        V1.1 §6 — Generate transfer data for the next interview round.

        Fields:
        - asked_projects: project drill records
        - asked_t_topics: T-type topics already asked
        - density_score: density verdict
        - coding_result: C question result
        """
        density = self.evaluate_density(bb)
        coding = self.evaluate_coding(bb)

        return RoundTransferData(
            asked_projects=list(bb.projects_drilled),
            asked_t_topics=list(bb.asked_t_topics),
            density_score=density,
            coding_result=coding,
            total_questions=bb.total_questions,
            round=bb.config.round,
        )

    async def generate_report(self, bb: BlackboardState) -> dict:
        """
        Generate comprehensive interview evaluation report.

        Returns a dict suitable for JSON serialization.
        """
        density = self.evaluate_density(bb)
        coding = self.evaluate_coding(bb)
        transfer = self.generate_round_transfer(bb)

        # Per-question summary
        question_summary = []
        for q in bb.question_history:
            question_summary.append({
                "index": q.question_index,
                "type": q.question_type.value,
                "topic": q.topic,
                "followup_depth": q.followup_depth,
                "duration_seconds": round(q.duration_seconds, 1),
                "overtime": q.overtime,
            })

        # Overtime questions
        overtime_questions = [q for q in bb.question_history if q.overtime]

        # Evaluation scores from agents
        agent_scores = {}
        for k, v in bb.evaluations.items():
            if v.ready:
                agent_scores[str(k)] = {"score": v.score, "notes": v.notes}

        # Posthoc pipeline: low-score deep review + fluency aggregation + efficiency matrix
        posthoc = await self._generate_posthoc_analysis(bb)

        report = {
            "round": bb.config.round,
            "total_questions": bb.total_questions,
            "total_duration_minutes": round(bb.elapsed_minutes, 1),
            "time_limit_minutes": bb.time_limit_minutes,

            # Density evaluation
            "density_verdict": density.value,
            "density_details": {
                "p_series_count": sum(
                    1 for q in bb.question_history
                    if q.question_type == QuestionType.P and q.followup_depth == 0
                ),
                "t_count": sum(
                    1 for q in bb.question_history
                    if q.question_type == QuestionType.T
                ),
                "c_count": sum(
                    1 for q in bb.question_history
                    if q.question_type == QuestionType.C
                ),
            },

            # Coding evaluation
            "coding_evaluation": coding,

            # Coverage
            "projects_covered": [
                {"name": p.project_name, "depth": p.max_followup_depth}
                for p in bb.projects_drilled
            ],
            "tech_areas_covered": bb.general_areas_covered,
            "t_topics_asked": bb.asked_t_topics,

            # Per-question detail
            "question_summary": question_summary,
            "overtime_count": len(overtime_questions),

            # Agent evaluations
            "agent_evaluations": agent_scores,

            # Lightweight per-question evaluation memory for posthoc report generation
            "evaluation_memory": [item.model_dump() for item in bb.evaluation_memory],

            # Posthoc report pipeline output
            "posthoc_analysis": posthoc,

            # Transfer data for next round
            "round_transfer": transfer.model_dump(),
        }

        return report

    async def _generate_posthoc_analysis(self, bb: BlackboardState) -> dict:
        """Generate post-interview analysis from evaluation memory.

        Includes:
        1) Low-score heavy-model deep review
        2) Fluency aggregation with dual-threshold warning rules
        3) Efficiency-quality matrix
        4) Consistency check (anti-memorization heuristic)
        5) Position-fit suggestion driven by research brief/company focus
        """
        per_question_reports = []
        for item in bb.evaluation_memory:
            fluency_eval = self._evaluate_fluency_dual_threshold(item)
            feedback = await self._generate_question_feedback(item)
            per_question_reports.append({
                "question_id": item.question_id,
                "question_index": item.question_index,
                "question_type": item.question_type.value,
                "question_text": item.question_text,
                "answer_text": item.answer_text,
                "quality_score_5": item.quality_score_5,
                "live_judgment": item.live_judgment,
                "fluency": fluency_eval,
                "feedback": feedback,
                "key_defects": item.key_defects,
                "follow_up_hints": item.follow_up_hints,
            })

        fluency_summary = self._aggregate_fluency(per_question_reports)
        efficiency_matrix = self._build_efficiency_matrix(bb.evaluation_memory)
        consistency_check = self._run_consistency_check(bb.evaluation_memory)
        position_fit = self._generate_position_fit(bb, bb.evaluation_memory)

        return {
            "question_reports": per_question_reports,
            "fluency_summary": fluency_summary,
            "efficiency_matrix": efficiency_matrix,
            "consistency_check": consistency_check,
            "position_fit": position_fit,
        }

    def _evaluate_fluency_dual_threshold(self, item: EvaluationMemoryItem) -> dict:
        """Evaluate disfluency with dual-threshold rules from structured metrics.

        Note: true 5-second window clustering requires ordered timestamp events.
        Current implementation uses a conservative count-based approximation.
        """
        metrics = item.fluency_metrics or {}
        snapshot = metrics.get("snapshot") or {}
        details = metrics.get("details") or {}
        word_gaps = details.get("wordGaps") or {}

        confirmed_ms = list(word_gaps.get("confirmedMs") or [])
        long_ms = list(word_gaps.get("longMs") or [])
        pauses_over_1s = len([gap for gap in (confirmed_ms + long_ms) if gap >= 1000])
        syntactic_break_count = len([gap for gap in (confirmed_ms + long_ms) if gap > 2000])

        filler_count = int(snapshot.get("fillerCount") or 0)
        repetition_count = self._estimate_repetition_count(item.answer_text)
        disfluency_events = filler_count + repetition_count + pauses_over_1s
        disfluency_cluster_count = disfluency_events // 3

        speech_rate_history = list((details.get("speechRateHistory") or []))
        wpm_std = 0.0
        if len(speech_rate_history) >= 2:
            try:
                wpm_std = float(statistics.pstdev(speech_rate_history))
            except statistics.StatisticsError:
                wpm_std = 0.0

        total_words_est = max(1, int(snapshot.get("speechRate") or 0))
        filler_density = filler_count / total_words_est

        silence_seconds = float((metrics.get("thinking") or {}).get("silenceSeconds") or item.thinking_time_silence_seconds or 0)
        duration_seconds = max(1.0, float(item.duration_seconds or 1.0))
        voice_break_ratio_estimated = min(1.0, silence_seconds / duration_seconds)

        danger_flags = []
        suggestion_flags = []

        if disfluency_cluster_count >= 2:
            danger_flags.append("不流利簇频率偏高")
        if syntactic_break_count >= 3:
            danger_flags.append("句中断裂风险")
        if voice_break_ratio_estimated > 0.15:
            danger_flags.append("语音断裂度偏高")

        if 0.05 <= filler_density <= 0.15:
            suggestion_flags.append("填充词密度可优化")
        if wpm_std > 40:
            suggestion_flags.append("语速波动可优化")

        if danger_flags:
            derived_tag = "critical"
        elif suggestion_flags:
            derived_tag = "warning"
        else:
            derived_tag = "normal"

        return {
            "fluency_tag": derived_tag,
            "disfluency_cluster_count": disfluency_cluster_count,
            "syntactic_break_count": syntactic_break_count,
            "voice_break_ratio_estimated": round(voice_break_ratio_estimated, 3),
            "filler_density": round(filler_density, 3),
            "wpm_std": round(wpm_std, 2),
            "danger_flags": danger_flags,
            "suggestion_flags": suggestion_flags,
        }

    async def _generate_question_feedback(self, item: EvaluationMemoryItem) -> dict:
        """Generate single-question posthoc feedback with dynamic length rules."""
        is_project = item.question_type == QuestionType.P

        if is_project:
            text = await self._generate_project_structured_feedback(item)
            return {
                "mode": "project_structured",
                "text": text,
                "length": len(text),
            }

        score = max(1, min(5, int(item.quality_score_5 or 3)))
        min_len, max_len = FEEDBACK_LENGTH_RULES[score]

        if score <= 3:
            text = await self._generate_low_score_heavy_feedback(item, min_len, max_len)
            mode = "heavy_model"
        else:
            text = self._generate_rule_based_feedback(item, min_len, max_len)
            mode = "rule_based"

        text = self._fit_length(text, min_len, max_len)
        return {
            "mode": mode,
            "text": text,
            "length": len(text),
            "target_range": [min_len, max_len],
        }

    async def _generate_project_structured_feedback(self, item: EvaluationMemoryItem) -> str:
        """Generate four-part structured feedback for project deep dive questions."""
        highlights = "；".join(item.follow_up_hints[:1]) if item.follow_up_hints else "能较好说明项目背景与职责。"
        defects = "；".join(item.key_defects[:2]) if item.key_defects else "建议补充关键权衡依据。"
        depth = "建议补充压测、容量或时延等量化数据，展示方案边界与trade-off。"
        risk = "若对异常与降级策略描述不足，可能在追问环节暴露实现细节盲区。"

        return (
            f"【项目亮点】{highlights}\n"
            f"【框架优化】建议按 STAR/SCQA 重排表达，先问题与约束，再方案与结果；{defects}\n"
            f"【深度挖掘】{depth}\n"
            f"【风险提示】{risk}"
        )

    async def _generate_low_score_heavy_feedback(
        self,
        item: EvaluationMemoryItem,
        min_len: int,
        max_len: int,
    ) -> str:
        """Use stronger LLM to produce detailed feedback for low-score answers.

        Falls back to deterministic template if model call fails.
        """
        prompt = (
            "你是技术面试复盘专家。请基于题目与回答，给出客观、可执行的中文反馈。"
            f"\n题目：{item.question_text}"
            f"\n回答：{item.answer_text[:1800]}"
            f"\n已知缺陷：{';'.join(item.key_defects[:5]) or '无'}"
            "\n要求："
            f"\n1) 输出{min_len}-{max_len}字；"
            "\n2) 先指出核心问题，再给改进框架与一个可练习方向；"
            "\n3) 避免空泛夸赞，必须可执行。"
        )

        try:
            response = await llm_complete(
                messages=[
                    {"role": "system", "content": "你是严谨的技术复盘顾问。"},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=420,
                module="eval",
            )
            cleaned = self._clean_text(response)
            if cleaned:
                return cleaned
        except Exception as exc:
            logger.warning(f"Heavy-model posthoc feedback failed for {item.question_id}: {exc}")

        return self._fallback_low_score_feedback(item)

    def _generate_rule_based_feedback(self, item: EvaluationMemoryItem, min_len: int, max_len: int) -> str:
        """Deterministic feedback for scores >=4."""
        defects = "；".join(item.key_defects[:2]) if item.key_defects else "建议补充边界条件与验证数据"
        hints = "；".join(item.follow_up_hints[:2]) if item.follow_up_hints else "可进一步说明异常场景处理"
        text = (
            f"回答整体较完整，核心要点覆盖较好。可继续优化：{defects}。"
            f"建议下一步强化：{hints}，让论证更具说服力。"
        )
        return self._fit_length(text, min_len, max_len)

    def _fallback_low_score_feedback(self, item: EvaluationMemoryItem) -> str:
        defects = "；".join(item.key_defects[:3]) if item.key_defects else "概念边界与推理链条不清"
        return (
            "本题回答存在关键缺口，主要问题在于核心概念与结论之间缺少可验证推导。"
            f"当前暴露点：{defects}。建议按“定义-机制-边界-案例”重构答案：先明确术语与前提，"
            "再说明机制如何解决具体问题，补充异常场景与trade-off，最后用一段可量化项目证据收束，"
            "并通过两轮自问自答训练提升稳定性。"
        )

    def _aggregate_fluency(self, question_reports: list[dict]) -> dict:
        total = len(question_reports)
        if total == 0:
            return {
                "total_questions": 0,
                "normal": 0,
                "warning": 0,
                "critical": 0,
                "alerts": [],
            }

        normal = 0
        warning = 0
        critical = 0
        critical_questions = []
        for row in question_reports:
            tag = (row.get("fluency") or {}).get("fluency_tag", "normal")
            if tag == "critical":
                critical += 1
                critical_questions.append(row.get("question_index"))
            elif tag == "warning":
                warning += 1
            else:
                normal += 1

        alerts = []
        if critical >= 2:
            alerts.append(
                f"表达流畅性警报：第{', '.join(str((idx or 0) + 1) for idx in critical_questions[:5])}题出现多次思维中断，可能影响观点传达"
            )
        if warning / total >= 0.30:
            alerts.append("建议优化表达节奏：面试中后段存在较多语速与停顿波动")

        return {
            "total_questions": total,
            "normal": normal,
            "warning": warning,
            "critical": critical,
            "alerts": alerts,
        }

    def _build_efficiency_matrix(self, items: list[EvaluationMemoryItem]) -> list[dict]:
        rows = []
        for item in items:
            category = self._question_category(item)
            baseline = EFFICIENCY_BASELINE_SECONDS[category]
            thinking = float(item.thinking_time_to_first_word_seconds or 0)
            score = int(item.quality_score_5 or 3)

            if thinking < baseline and score >= 4:
                tag = "熟练"
                feedback = ""
            elif thinking > baseline * 2 and score >= 4:
                tag = "熟练但犹豫"
                feedback = "建议通过模拟面试建立条件反射"
            elif thinking > baseline * 2 and score < 3:
                tag = "薄弱"
                feedback = "需系统学习相关知识点"
            else:
                tag = "一般"
                feedback = ""

            rows.append({
                "question_id": item.question_id,
                "category": category,
                "baseline_seconds": baseline,
                "thinking_time_seconds": thinking,
                "quality_score_5": score,
                "tag": tag,
                "feedback": feedback,
            })
        return rows

    def _run_consistency_check(self, items: list[EvaluationMemoryItem]) -> dict:
        """Detect possible memorization pattern from speed-quality inconsistency."""
        fast_high_knowledge = [
            x for x in items
            if self._question_category(x) == "knowledge"
            and float(x.thinking_time_to_first_word_seconds or 0) < 3
            and int(x.quality_score_5 or 0) >= 4
        ]
        low_project = [
            x for x in items
            if x.question_type == QuestionType.P and int(x.quality_score_5 or 0) < 2
        ]

        flagged = bool(fast_high_knowledge and low_project)
        return {
            "flagged": flagged,
            "message": "疑似背诵，建议加强项目复盘深度" if flagged else "",
            "evidence": {
                "fast_high_knowledge_count": len(fast_high_knowledge),
                "low_project_count": len(low_project),
            },
        }

    def _generate_position_fit(self, bb: BlackboardState, items: list[EvaluationMemoryItem]) -> dict:
        company_focus = self._extract_company_focus(bb.research_brief_summary)
        if not company_focus:
            return {
                "company_focus": "",
                "suggestion": "",
            }

        focus_related_low = 0
        focus_related_high = 0
        for item in items:
            text = f"{item.question_text} {item.answer_text}".lower()
            if company_focus.lower() in text:
                if int(item.quality_score_5 or 0) < 3:
                    focus_related_low += 1
                elif int(item.quality_score_5 or 0) >= 4:
                    focus_related_high += 1

        if focus_related_low > 0:
            suggestion = f"目标公司当前关注「{company_focus}」，建议优先补强该方向的项目证据与落地细节。"
        elif focus_related_high > 0:
            suggestion = f"建议在后续面试主动引导至「{company_focus}」话题，放大你的相关项目优势。"
        else:
            suggestion = f"可围绕公司焦点「{company_focus}」准备两段结构化案例，提升岗位匹配度。"

        return {
            "company_focus": company_focus,
            "suggestion": suggestion,
        }

    def _extract_company_focus(self, research_summary: str) -> str:
        if not research_summary:
            return ""

        lines = [line.strip() for line in research_summary.splitlines() if line.strip()]
        for line in lines:
            if any(key in line for key in ("焦点", "重点", "方向", "战略")):
                return re.sub(r"^[\-\*\d\.\s:：]+", "", line)[:60]

        return lines[0][:60] if lines else ""

    def _estimate_repetition_count(self, text: str) -> int:
        if not text:
            return 0
        zh_repeat = len(re.findall(r"([\u4e00-\u9fff])\1", text))
        en_repeat = len(re.findall(r"\b(\w+)\s+\1\b", text.lower()))
        return zh_repeat + en_repeat

    def _question_category(self, item: EvaluationMemoryItem) -> str:
        if item.question_type == QuestionType.P:
            return "scenario"
        if item.question_type == QuestionType.C:
            return "design"
        return "knowledge"

    def _fit_length(self, text: str, min_len: int, max_len: int) -> str:
        clean = self._clean_text(text)
        if len(clean) > max_len:
            return clean[:max_len].rstrip("，。；,.;") + "。"
        if len(clean) < min_len:
            padding = "建议按定义、机制、边界、案例四步复盘并进行限时复述训练。"
            while len(clean) < min_len:
                clean = (clean + padding)[:max_len]
                if len(clean) >= min_len:
                    break
        return clean

    def _clean_text(self, text: str) -> str:
        if not text:
            return ""
        cleaned = re.sub(r"\s+", "", text)
        cleaned = cleaned.replace("```", "")
        return cleaned

    def _strong_model_name(self) -> str:
        if settings.LLM_PROVIDER == "qwen":
            return settings.QWEN_MODEL_STRONG
        if settings.LLM_PROVIDER == "moonshot":
            return settings.MOONSHOT_MODEL_STRONG
        if settings.LLM_PROVIDER == "openai":
            return settings.OPENAI_MODEL_STRONG
        return settings.ANTHROPIC_MODEL
