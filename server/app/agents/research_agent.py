"""
Research Agent — Company Intelligence Pre-Research.

Performs a four-phase deep dive on the target company/BU before the interview:
  Phase 1: Product version intelligence (recent tech changes)
  Phase 2: Strategic/architectural intelligence (recent 3 months)
  Phase 3: Tech stack gap analysis & interview question prediction
  Phase 4: Report generation (full markdown + concise summary)

Uses Qwen's built-in web search (enable_search=True) for Phases 1 & 2.
Phase 3 & 4 use standard LLM completion (no search needed).
"""
from __future__ import annotations

import json
import logging
import time
from typing import Optional

from app.services.llm_service import llm_complete
from app.core.config import settings

logger = logging.getLogger(__name__)


PHASE1_SYSTEM = """你是一位技术情报分析师，请使用联网搜索功能收集指定公司业务线的产品版本与技术更新情报。

你的任务：
1. 搜索该业务线最近 3-6 个月内的版本更新、技术博客、Release Notes
2. 提取：版本号、技术变更点（特别是后端架构、框架升级、性能优化）
3. 关注「迁移至」「引入」「重构」「升级」等技术变迁关键词

输出格式必须是有效的 JSON（不要加 markdown 代码块标记），结构：
{
  "data_quality": "rich|limited|none",
  "version_updates": [
    {
      "version_or_date": "版本号或时间",
      "summary": "核心变更描述",
      "tech_signals": ["信号1", "信号2"],
      "source": "来源URL或名称"
    }
  ],
  "tech_change_signals": ["整体技术趋势信号1", "信号2"],
  "search_coverage": "实际搜索到的内容范围说明"
}

如果搜索无结果，data_quality 设为 "none"，version_updates 为空数组。"""


PHASE2_SYSTEM = """你是一位技术战略分析师，请使用联网搜索功能收集指定公司业务线的近期技术战略动态。

你的任务：
1. 搜索近 3 个月内（优先）该业务线的技术架构文章、大会演讲（QCon/ArchSummit）、InfoQ/36kr报道
2. 搜索该业务线招聘 JD 中的高频技术词，判断技术人才缺口方向
3. 提取当前技术攻坚领域、架构改造方向、开源偏好

输出格式必须是有效的 JSON（不要加 markdown 代码块标记），结构：
{
  "data_quality": "rich|limited|none",
  "tech_focus_areas": ["当前主要技术攻坚领域1", "领域2"],
  "architecture_signals": ["架构改造信号1", "信号2"],
  "talent_gap_signals": ["招聘JD高频词反映的人才需求1", "需求2"],
  "key_news": [
    {
      "title": "新闻/文章标题",
      "summary": "核心观点",
      "signal_type": "architecture|hiring|open_source|product",
      "source": "来源",
      "date": "日期"
    }
  ],
  "search_coverage": "实际搜索到的内容范围说明"
}"""


PHASE3_SYSTEM = """你是一位资深技术招聘专家，请根据公司情报和候选人技术栈，生成结构化的面试情报分析。

分析逻辑：
1. 基于 Phase 1+2 情报推断公司当前技术挑战
2. 计算候选人技术栈与公司需求的交集（优势）和差集（风险点）
3. 生成预测面试问题（业务场景题、技术深挖题、匹配度拷问）

输出必须是有效的 JSON（不要加 markdown 代码块标记），结构：
{
  "tech_challenges": ["公司当前面临的技术挑战1", "挑战2"],
  "match_analysis": {
    "matched_skills": [
      {"skill": "技术名", "company_usage": "在该公司的应用场景", "interview_focus": "面试时的考察深度"}
    ],
    "gaps": ["候选人缺失但公司需要的技术1", "技术2"],
    "match_score": 75,
    "risk_level": "高|中|低",
    "risk_desc": "风险说明"
  },
  "predicted_questions": [
    {
      "type": "业务场景|技术深挖|匹配度拷问",
      "question": "具体问题",
      "intent": "考察意图",
      "depth": 3,
      "related_company_context": "与公司情报的关联点"
    }
  ]
}

预测问题要求：至少 6 个，其中技术深挖题不少于 3 个。"""


class ResearchAgent:
    """Executes the four-phase company intelligence research."""

    def __init__(self):
        # Web search is supported for both Qwen and Moonshot (Kimi) providers
        provider = settings.get_module_provider("research")
        if provider == "qwen":
            self._use_search = bool(settings.QWEN_API_KEY)
        elif provider == "moonshot":
            self._use_search = bool(settings.MOONSHOT_API_KEY)
        else:
            self._use_search = False

        if not self._use_search:
            logger.warning(
                "ResearchAgent: Web search disabled (no API key or unsupported provider). "
                "Phases 1 & 2 will use LLM knowledge without live search."
            )
        else:
            logger.info(
                f"ResearchAgent: Web search enabled via {provider}."
            )

    async def run_phase1(self, company: str, business_unit: str) -> dict:
        """Phase 1: Product version intelligence."""
        logger.info(f"[Research] Phase 1 start: {company} / {business_unit}")
        prompt = (
            f"请搜索并分析：{company} {business_unit} 最近的产品版本更新和技术变更情报。\n\n"
            f"搜索关键词（依次执行）：\n"
            f"1. \"{company} {business_unit} 版本更新 技术博客 2025\"\n"
            f"2. \"{company} {business_unit} 架构升级 重构 新功能发布\"\n"
            f"3. \"{company} {business_unit} Release Notes changelog GitHub\"\n\n"
            f"目标：收集近 6 个月内的版本迭代和技术变更信号。"
        )
        try:
            raw = await llm_complete(
                messages=[
                    {"role": "system", "content": PHASE1_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                max_tokens=2048,
                enable_search=self._use_search,
                module="research",
            )
            return self._parse_json(raw, "phase1")
        except Exception as e:
            logger.error(f"[Research] Phase 1 failed: {e}")
            return {"data_quality": "none", "version_updates": [], "tech_change_signals": [], "error": str(e)}

    async def run_phase2(self, company: str, business_unit: str) -> dict:
        """Phase 2: Strategic intelligence."""
        logger.info(f"[Research] Phase 2 start: {company} / {business_unit}")
        prompt = (
            f"请搜索并分析：{company} {business_unit} 近 3 个月内的技术战略动态。\n\n"
            f"搜索关键词（依次执行）：\n"
            f"1. \"{company} {business_unit} 技术架构 site:infoq.cn OR site:36kr.com\"\n"
            f"2. \"{company} {business_unit} 演讲 QCon ArchSummit 技术分享 2025\"\n"
            f"3. \"{company} {business_unit} 后端招聘 技术要求 JD\"\n"
            f"4. \"{company} {business_unit} 开源 GitHub 技术攻坚\"\n\n"
            f"目标：识别当前技术攻坚方向、架构改造信号和人才缺口。"
        )
        try:
            raw = await llm_complete(
                messages=[
                    {"role": "system", "content": PHASE2_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                max_tokens=2048,
                enable_search=self._use_search,
                module="research",
            )
            return self._parse_json(raw, "phase2")
        except Exception as e:
            logger.error(f"[Research] Phase 2 failed: {e}")
            return {"data_quality": "none", "tech_focus_areas": [], "key_news": [], "error": str(e)}

    async def run_phase3(
        self,
        company: str,
        business_unit: str,
        position_type: str,
        candidate_tech_stack: list[str],
        phase1_data: dict,
        phase2_data: dict,
    ) -> dict:
        """Phase 3: Tech stack gap analysis & question prediction."""
        logger.info(f"[Research] Phase 3 start: {company} / {business_unit}")
        intel_summary = {
            "company": company,
            "business_unit": business_unit,
            "position_type": position_type,
            "candidate_tech_stack": candidate_tech_stack,
            "version_intelligence": {
                "data_quality": phase1_data.get("data_quality", "none"),
                "tech_change_signals": phase1_data.get("tech_change_signals", []),
                "recent_versions": phase1_data.get("version_updates", [])[:3],
            },
            "strategic_intelligence": {
                "data_quality": phase2_data.get("data_quality", "none"),
                "tech_focus_areas": phase2_data.get("tech_focus_areas", []),
                "architecture_signals": phase2_data.get("architecture_signals", []),
                "talent_gap_signals": phase2_data.get("talent_gap_signals", []),
            },
        }
        prompt = f"""请分析以下面试情报，生成候选人技术匹配度分析和预测问题：

{json.dumps(intel_summary, ensure_ascii=False, indent=2)}

注意：
- 预测问题必须结合公司真实技术场景（从情报中提取），不要生成通用八股文
- 如情报有限（data_quality=none），基于岗位通用技术深度生成，但要标注"基于岗位经验"
"""
        try:
            raw = await llm_complete(
                messages=[
                    {"role": "system", "content": PHASE3_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=3000,
                module="research",
            )
            return self._parse_json(raw, "phase3")
        except Exception as e:
            logger.error(f"[Research] Phase 3 failed: {e}")
            return {"tech_challenges": [], "match_analysis": {}, "predicted_questions": [], "error": str(e)}

    def build_reports(
        self,
        company: str,
        business_unit: str,
        position_type: str,
        candidate_tech_stack: list[str],
        phase1: dict,
        phase2: dict,
        phase3: dict,
    ) -> tuple[str, str]:
        """Phase 4: Generate full_report (markdown) and summary (~800 tokens).
        
        Returns: (full_report, summary)
        """
        now = time.strftime("%Y-%m-%d %H:%M")
        p1_quality = phase1.get("data_quality", "none")
        p2_quality = phase2.get("data_quality", "none")
        has_live_data = p1_quality != "none" or p2_quality != "none"
        intel_note = "" if has_live_data else "\n> ⚠️ 该业务线公开信息有限，以下分析基于岗位通用技术深度。\n"

        analysis = phase3.get("match_analysis", {})
        matched = analysis.get("matched_skills", [])
        gaps = analysis.get("gaps", [])
        risk = analysis.get("risk_level", "中")
        questions = phase3.get("predicted_questions", [])
        challenges = phase3.get("tech_challenges", [])

        # ── Full Report ──────────────────────────────────────────
        full_lines = [
            f"# 面试情报摘要：{company} · {business_unit}",
            f"",
            f"**生成时间**: {now}  ",
            f"**目标岗位**: {position_type}  ",
            f"**候选人技术栈**: {', '.join(candidate_tech_stack) if candidate_tech_stack else '未指定'}  ",
            f"**情报质量**: Phase1={p1_quality} / Phase2={p2_quality}",
            intel_note,
            f"---",
            f"",
            f"## 【静态知识库】BU 核心信息",
            f"*(来源：bu_knowledge YAML，面试 session 初始化时合并)*",
            f"",
            f"## 【实时情报 Phase 1】产品版本动态",
        ]

        version_updates = phase1.get("version_updates", [])
        if version_updates:
            full_lines.append("| 版本/时间 | 核心变更 | 技术信号 |")
            full_lines.append("|---------|--------|--------|")
            for v in version_updates[:4]:
                signals = "、".join(v.get("tech_signals", [])[:3])
                full_lines.append(f"| {v.get('version_or_date','?')} | {v.get('summary','?')[:60]} | {signals} |")
        else:
            full_lines.append("> 未搜索到版本更新记录")

        tech_signals = phase1.get("tech_change_signals", [])
        if tech_signals:
            full_lines.append("\n**整体技术变迁信号：**")
            for s in tech_signals:
                full_lines.append(f"- {s}")

        full_lines += [
            f"",
            f"## 【实时情报 Phase 2】技术战略动态",
        ]

        focus_areas = phase2.get("tech_focus_areas", [])
        arch_signals = phase2.get("architecture_signals", [])
        talent_signals = phase2.get("talent_gap_signals", [])
        key_news = phase2.get("key_news", [])

        if focus_areas:
            full_lines.append("\n**当前技术攻坚领域：**")
            for f in focus_areas:
                full_lines.append(f"- {f}")
        if arch_signals:
            full_lines.append("\n**架构改造信号：**")
            for s in arch_signals:
                full_lines.append(f"- {s}")
        if talent_signals:
            full_lines.append("\n**人才缺口信号（来自JD）：**")
            for s in talent_signals:
                full_lines.append(f"- {s}")
        if key_news:
            full_lines.append("\n**近期关键动态：**")
            for n in key_news[:4]:
                full_lines.append(f"- [{n.get('title','?')}]({n.get('source','')})：{n.get('summary','')[:80]}")

        full_lines += [
            f"",
            f"## 【Phase 3 分析】候选人技术匹配度",
            f"",
            f"**风险等级**: {risk}  ",
            f"**匹配分**: {analysis.get('match_score', '?')}/100  ",
            f"**风险说明**: {analysis.get('risk_desc', '')}",
            f"",
            f"### 公司当前技术挑战",
        ]
        for c in challenges:
            full_lines.append(f"- {c}")

        full_lines += [f"", f"### ✅ 技术交集（面试深挖重点）"]
        if matched:
            for m in matched:
                skill = m.get("skill", "?")
                usage = m.get("company_usage", "")
                focus = m.get("interview_focus", "")
                full_lines.append(f"- **{skill}**：{usage}（考察：{focus}）")
        else:
            full_lines.append("- 暂无明确匹配数据")

        full_lines += [f"", f"### ⚠️ 技术差距（风险探查）"]
        for g in gaps:
            full_lines.append(f"- {g}")
        if not gaps:
            full_lines.append("- 未识别明显差距")

        full_lines += [f"", f"## 【Phase 3 分析】预测必问问题"]
        type_emoji = {"业务场景": "🟡", "技术深挖": "🔴", "匹配度拷问": "🟢"}
        for i, q in enumerate(questions[:8], 1):
            qtype = q.get("type", "技术深挖")
            emoji = type_emoji.get(qtype, "⚪")
            full_lines += [
                f"",
                f"### {i}. {emoji} {qtype}（深度 {q.get('depth', 3)}/5）",
                f"",
                f"**问题**: {q.get('question', '')}  ",
                f"**考察意图**: {q.get('intent', '')}  ",
                f"**情报关联**: {q.get('related_company_context', '')}",
            ]

        full_report = "\n".join(full_lines)

        # ── Summary (~800 tokens) ────────────────────────────────
        summary_lines = [
            f"## 公司情报预调研摘要（{company} · {business_unit}，{now}）",
            f"",
            f"**岗位**: {position_type}  **风险等级**: {risk}",
        ]

        if challenges:
            summary_lines.append(f"\n**公司当前技术挑战**: {'; '.join(challenges[:3])}")

        if focus_areas or tech_signals:
            combined = (focus_areas + tech_signals)[:4]
            summary_lines.append(f"**技术战略信号**: {'; '.join(combined)}")

        if arch_signals:
            summary_lines.append(f"**架构改造方向**: {'; '.join(arch_signals[:2])}")

        if matched:
            matched_str = ", ".join(
                f"{m.get('skill')}（{m.get('interview_focus', '')}）"
                for m in matched[:4]
            )
            summary_lines.append(f"\n**候选人优势技术（建议深挖）**: {matched_str}")

        if gaps:
            summary_lines.append(f"**技术差距（风险探查）**: {'; '.join(gaps[:3])}")

        if questions:
            deep_qs = [q for q in questions if q.get("type") == "技术深挖"][:3]
            if deep_qs:
                summary_lines.append(f"\n**预测技术深挖题**:")
                for q in deep_qs:
                    summary_lines.append(f"- {q.get('question')} （意图: {q.get('intent', '')}）")

            scenario_qs = [q for q in questions if q.get("type") == "业务场景"][:2]
            if scenario_qs:
                summary_lines.append(f"\n**预测业务场景题**:")
                for q in scenario_qs:
                    summary_lines.append(f"- {q.get('question')}")

        if not has_live_data:
            summary_lines.append(
                "\n> ⚠️ 注意：该业务线公开技术情报有限，以上预测基于岗位通用深度，"
                "面试时建议重点结合候选人简历中的具体项目进行追问。"
            )

        summary = "\n".join(summary_lines)
        return full_report, summary

    @staticmethod
    def _parse_json(raw: str, phase: str) -> dict:
        """Parse JSON from LLM response, stripping markdown fences."""
        try:
            cleaned = raw.strip()
            # Strip markdown code fences if present
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                # Remove first (```json or ```) and last (```) lines
                lines = [l for l in lines[1:] if l.strip() != "```"]
                cleaned = "\n".join(lines).strip()
            return json.loads(cleaned)
        except json.JSONDecodeError as e:
            logger.warning(f"[Research] {phase} JSON parse failed: {e}. Raw (first 300): {raw[:300]}")
            return {"data_quality": "limited", "parse_error": str(e), "raw_partial": raw[:500]}
