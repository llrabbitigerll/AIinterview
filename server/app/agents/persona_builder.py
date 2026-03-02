"""
Dynamic Persona Builder — Three-Layer Knowledge Merge.

Generates interview agent personas by merging:
  Layer 1: levels/{position_type}.yaml  — Base behavior template per T-level
  Layer 2: companies/{company_key}.yaml — Company culture patch
  Layer 3: bu_knowledge/{company_key}_{bu_key}_{position_type}.yaml — BU tech knowledge

The merge order is L1 → L2 patch → L3 patch, with later layers overriding
or extending earlier ones.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import yaml

from app.core.config import settings
from app.models.schemas import InterviewConfig

logger = logging.getLogger(__name__)


class DynamicPersonaBuilder:
    """
    Builds agent personas via three-layer YAML merge.

    Public API:
        build(config, interviewer_level, agent_role) → str (system prompt)

    Legacy wrappers (deprecated, call build() internally):
        build_agent_b_prompt(...)
        build_agent_c_prompt(...)
    """

    def __init__(self):
        self._level_config: dict[str, Any] = {}
        self._level_templates: dict[str, dict[str, Any]] = {}  # keyed by position_type
        self._company_patches: dict[str, dict[str, Any]] = {}  # keyed by company_key
        self._bu_knowledge: dict[str, dict[str, Any]] = {}     # keyed by "{company_key}_{bu_key}_{position_type}"
        self._load_all()

    # ── Loading ──────────────────────────────────────────────

    def _load_all(self) -> None:
        """Load all four knowledge sources."""
        kd = settings.KNOWLEDGE_DIR

        # 1. level_config.yaml
        self._level_config = self._safe_load(os.path.join(kd, "level_config.yaml"))

        # 2. levels/*.yaml  (backend.yaml, frontend.yaml, ...)
        levels_dir = os.path.join(kd, "levels")
        if os.path.isdir(levels_dir):
            for fname in os.listdir(levels_dir):
                if fname.endswith(".yaml"):
                    key = fname.replace(".yaml", "")  # "backend" / "frontend"
                    self._level_templates[key] = self._safe_load(
                        os.path.join(levels_dir, fname)
                    )

        # 3. companies/*.yaml
        companies_dir = os.path.join(kd, "companies")
        if os.path.isdir(companies_dir):
            for fname in os.listdir(companies_dir):
                if fname.endswith(".yaml"):
                    data = self._safe_load(os.path.join(companies_dir, fname))
                    ckey = data.get("company_key", fname.replace(".yaml", ""))
                    self._company_patches[ckey] = data

        # 4. bu_knowledge/*.yaml
        bu_dir = os.path.join(kd, "bu_knowledge")
        if os.path.isdir(bu_dir):
            for fname in os.listdir(bu_dir):
                if fname.endswith(".yaml"):
                    data = self._safe_load(os.path.join(bu_dir, fname))
                    bkey = fname.replace(".yaml", "")  # e.g. "bytedance_douyin_backend"
                    self._bu_knowledge[bkey] = data

        logger.info(
            f"PersonaBuilder loaded: {len(self._level_templates)} level templates, "
            f"{len(self._company_patches)} company patches, "
            f"{len(self._bu_knowledge)} BU knowledge files"
        )

    @staticmethod
    def _safe_load(path: str) -> dict:
        """Load a YAML file, returning {} on error."""
        if not os.path.exists(path):
            logger.warning(f"YAML file not found: {path}")
            return {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
        except Exception as e:
            logger.error(f"Failed to load {path}: {e}")
            return {}

    # ── Three-Layer Merge ────────────────────────────────────

    def _merge_layers(
        self,
        config: InterviewConfig,
        interviewer_level: str,
    ) -> dict[str, Any]:
        """
        Merge Layer 1 + Layer 2 patch + Layer 3 into a single context dict.

        Returns a flat dict with all fields needed for prompt generation.
        """
        pos = config.position_type  # "backend" / "frontend"
        company_key = self._resolve_company_key(config)
        bu_file_key = f"{company_key}_{config.bu_key}_{pos}" if config.bu_key else ""

        merged: dict[str, Any] = {}

        # ── Layer 1: base level template ──
        template = self._level_templates.get(pos, {})
        level_block = template.get(interviewer_level, {})
        if level_block:
            merged.update(level_block)
        else:
            logger.warning(
                f"No Layer-1 block for level={interviewer_level} pos={pos}, using defaults"
            )

        # ── Layer 2: company culture patch ──
        company_data = self._company_patches.get(company_key, {})
        if company_data:
            # Apply global company traits
            merged["company_name"] = company_data.get("company_name", config.company)
            merged["culture_style"] = company_data.get("culture_style", "")
            merged["values"] = company_data.get("values", [])
            merged["interview_common_traits"] = company_data.get("interview_common_traits", [])
            merged["known_hot_topics"] = company_data.get("known_hot_topics", {}).get(pos, [])
            merged["interview_process_meta"] = company_data.get("interview_process_meta", {})

            # Apply level-specific patch (overrides/extends Layer 1)
            level_patch = company_data.get("level_patches", {}).get(interviewer_level, {})
            if level_patch:
                if "personality_override" in level_patch:
                    merged["personality_base"] = level_patch["personality_override"]
                if "extra_concerns" in level_patch:
                    existing = merged.get("concerns", [])
                    merged["concerns"] = existing + level_patch["extra_concerns"]
                if "evaluation_weight_override" in level_patch:
                    merged["evaluation_criteria"] = level_patch["evaluation_weight_override"]
                if "stress_test_patterns_override" in level_patch:
                    merged["stress_test_patterns"] = level_patch["stress_test_patterns_override"]
                if "coding_requirement" in level_patch:
                    merged["coding_requirement"] = level_patch["coding_requirement"]
                if "interview_style_note" in level_patch:
                    merged["interview_style_note"] = level_patch["interview_style_note"]
                if "dual_agent_b_style" in level_patch:
                    merged["dual_agent_b_style"] = level_patch["dual_agent_b_style"]

        # ── Layer 3: BU tech knowledge ──
        bu_data = self._bu_knowledge.get(bu_file_key, {})
        if bu_data:
            merged["bu_name"] = bu_data.get("bu", config.business_unit)
            merged["context_intro"] = bu_data.get("context_intro", "")
            merged["tech_stack"] = bu_data.get("tech_stack", {})
            merged["core_domains"] = bu_data.get("core_domains", [])
            merged["current_pain_points"] = bu_data.get("current_pain_points", [])
            merged["team_specific_culture"] = bu_data.get("team_specific_culture", [])
            merged["common_interview_topics"] = bu_data.get("common_interview_topics", [])

            # Depth guidance based on candidate target level
            depth_map = bu_data.get("interview_depth_by_target_level", {})
            tl = config.target_level
            if tl in ("T1", "T2"):
                merged["depth_guidance"] = depth_map.get("T1_T2", {})
            elif tl in ("T3", "T4"):
                merged["depth_guidance"] = depth_map.get("T3_T4", {})
            elif tl in ("T5", "T6"):
                merged["depth_guidance"] = depth_map.get("T5_T6", {})

        return merged

    def _resolve_company_key(self, config: InterviewConfig) -> str:
        """Resolve company_key from config, falling back to name-based lookup."""
        if config.bu_key:
            # Infer company_key from bu_key pattern in bu_knowledge keys
            for bk in self._bu_knowledge:
                if config.bu_key in bk:
                    return bk.split("_")[0]
        # Try matching company_name to known patches
        for ckey, cdata in self._company_patches.items():
            if cdata.get("company_name") == config.company:
                return ckey
        # Fallback: use first word as guess
        name_map = {
            "字节跳动": "bytedance", "腾讯": "tencent", "阿里巴巴": "alibaba",
            "阿里": "alibaba", "京东": "jd", "美团": "meituan",
        }
        return name_map.get(config.company, config.company.lower())

    # ── Prompt Generation ────────────────────────────────────

    def build(
        self,
        config: InterviewConfig,
        interviewer_level: str,
        agent_role: str = "agent_b",
        research_brief_summary: str = "",
    ) -> str:
        """
        Single entry-point: build a system prompt for the given agent role.

        Args:
            config: InterviewConfig with company/bu/position/target_level/resume
            interviewer_level: T1~T8 — the interviewer's own level this round
            agent_role: "agent_b" (technical) or "agent_c" (business/strategic)
            research_brief_summary: Optional pre-research intel summary to inject
                as Layer 4 (real-time intelligence) at the end of the system prompt.

        Returns:
            Complete system prompt string.
        """
        ctx = self._merge_layers(config, interviewer_level)
        cheat_sheet = config.resume.interview_cheat_sheet

        if agent_role == "agent_c":
            prompt = self._render_agent_c_prompt(config, ctx, interviewer_level, cheat_sheet)
        else:
            prompt = self._render_agent_b_prompt(config, ctx, interviewer_level, cheat_sheet)

        # ── Layer 4: Real-time Research Intelligence ──
        if research_brief_summary.strip():
            prompt += f"""

---

## 【静态知识库】BU 技术特征
*(来源：bu_knowledge YAML，包含通用技术栈和高频考点，已整合在上方各节中)*

## 【实时情报】面试前预调研报告
*(来源：联网搜索实时情报，请结合以下内容出题，优先聚焦公司当前技术挑战)*

{research_brief_summary}
"""

        return prompt

    def _render_agent_b_prompt(
        self,
        config: InterviewConfig,
        ctx: dict[str, Any],
        level: str,
        cheat_sheet: str,
    ) -> str:
        """Render the technical interviewer (Agent B) prompt."""
        company = ctx.get("company_name", config.company)
        bu = ctx.get("bu_name", config.business_unit)
        identity = ctx.get("interviewer_identity", f"资深{config.position_type}工程师")
        personality = ctx.get("personality_base", "严谨但友好")
        comm_style = ctx.get("communication_style", "引导式提问")
        pressure = ctx.get("pressure_style", "适度追问")
        follow_depth = ctx.get("follow_up_depth", 2)
        follow_pattern = ctx.get("follow_up_pattern", ["方案 → 细节 → 边界"])

        # Tech stack (from Layer 3 or fallback)
        tech_stack = ctx.get("tech_stack", {})
        if isinstance(tech_stack, dict):
            all_tech = []
            for v in tech_stack.values():
                if isinstance(v, list):
                    all_tech.extend(v)
            tech_str = ", ".join(all_tech[:15]) if all_tech else "通用技术栈"
        else:
            tech_str = str(tech_stack)

        # Interview focus
        focus = ctx.get("interview_focus", {})
        tech_focus = focus.get("technical", [])
        behav_focus = focus.get("behavioral", [])

        # Evaluation criteria
        eval_criteria = ctx.get("evaluation_criteria", {})
        eval_str = "\n".join(f"  - {k}: {v}" for k, v in eval_criteria.items()) if eval_criteria else "  综合评估"

        # Red flags
        red_flags = ctx.get("red_flags", [])
        red_str = "\n".join(f"  - {r}" for r in red_flags) if red_flags else "  无特殊红线"

        # Stress test patterns
        stress = ctx.get("stress_test_patterns", [])
        stress_str = "\n".join(f"  - {s}" for s in stress) if stress else ""

        # Core domains from Layer 3
        domains = ctx.get("core_domains", [])
        domains_str = ""
        if domains:
            parts = []
            for d in domains[:4]:
                name = d.get("name", "")
                arch = d.get("architecture", "")
                hfq = d.get("high_frequency_questions", [])
                part = f"  【{name}】架构：{arch}"
                if hfq:
                    part += "\n    高频题：" + "；".join(hfq[:3])
                parts.append(part)
            domains_str = "\n".join(parts)

        # Company culture
        culture = ctx.get("culture_style", "")
        values = ctx.get("values", [])
        traits = ctx.get("interview_common_traits", [])
        concerns = ctx.get("concerns", [])

        # Context intro from Layer 3
        context_intro = ctx.get("context_intro", "")

        # Depth guidance
        depth_guidance = ctx.get("depth_guidance", {})
        depth_str = ""
        if depth_guidance:
            depth_str = f"\n候选人级别考察深度：{depth_guidance.get('focus', '')}\n示例话题：{', '.join(depth_guidance.get('sample_topics', []))}\n要求深度：{depth_guidance.get('depth', '')}"

        # Interview style note (company-level override)
        style_note = ctx.get("interview_style_note", "")
        dual_style = ctx.get("dual_agent_b_style", "")

        # Hot topics
        hot_topics = ctx.get("known_hot_topics", [])
        hot_str = ", ".join(hot_topics[:8]) if hot_topics else ""

        # Strategic perspective (T7/T8)
        strategic = ctx.get("strategic_perspective", [])
        strategic_str = ""
        if strategic:
            strategic_str = "\n## 战略视角（高级面试官特有）\n" + "\n".join(f"- {s}" for s in strategic)

        # Senior candidate assessment (T7/T8)
        senior_assess = ctx.get("senior_candidate_assessment", [])
        senior_str = ""
        if senior_assess:
            senior_str = "\n## 高级候选人特殊考察\n" + "\n".join(f"- {s}" for s in senior_assess)

        prompt = f"""# Role: {company} · {bu} 技术面试官（{level}级）

## 你的身份
{identity}

## 公司文化
{culture if culture else '专业、严谨'}
{('价值观：' + ', '.join(values)) if values else ''}
{('面试特点：' + '；'.join(traits[:3])) if traits else ''}

## BU背景
{context_intro if context_intro else f'{company}{bu}团队'}

## 你关注的点
{chr(10).join('- ' + c for c in concerns) if concerns else '- 技术深度和系统设计能力'}

## 技术栈
{tech_str}

## 核心业务域
{domains_str if domains_str else '通用后端/前端技术'}

## 技术考察重点
{chr(10).join('- ' + t for t in tech_focus) if tech_focus else '- 系统设计与工程实践'}

## 行为考察重点
{chr(10).join('- ' + b for b in behav_focus) if behav_focus else '- 问题解决思路'}
{depth_str}
{strategic_str}
{senior_str}

## 候选人信息
{cheat_sheet}

## 你的面试风格
- 性格：{personality}
- 沟通方式：{comm_style}
- 压力风格：{pressure}
- 追问深度：平均{follow_depth}层
- 追问模式：{'；'.join(follow_pattern)}
{('- 公司特有风格：' + style_note) if style_note else ''}
{('- 双Agent模式风格：' + dual_style) if dual_style else ''}

## 评分维度
{eval_str}

## 红线（遇到直接降低评级）
{red_str}

{('## 压力测试题型' + chr(10) + stress_str) if stress_str else ''}

{('## 公司高频考点：' + hot_str) if hot_str else ''}

## 重要规则
- 每次只问一个问题，不要一次问多个
- 问题要与候选人的实际经验相关
- 注意候选人简历中标记的"可疑点"，适当验证
- 当接收到模式切换指令时，自然过渡话题
- 你负责**技术深度考察**：项目技术方案、架构设计、性能优化、底层原理

## 行为红线（严格禁止）
- 永远不要让候选人决定讨论话题或问题方向
- 不要说"你想聊哪个项目""你对哪方面更感兴趣""你觉得哪个更有挑战"等开放式选择题
- 每次回复必须包含一个具体的技术追问或新问题
- 如果候选人试图转移话题，礼貌但坚定地拉回当前考察方向
- 面试主导权完全在你手中，你决定问什么、何时切换话题
"""
        return prompt.strip()

    def _render_agent_c_prompt(
        self,
        config: InterviewConfig,
        ctx: dict[str, Any],
        level: str,
        cheat_sheet: str,
    ) -> str:
        """Render the business/strategic interviewer (Agent C) prompt."""
        company = ctx.get("company_name", config.company)
        bu = ctx.get("bu_name", config.business_unit)
        culture = ctx.get("culture_style", "")
        values = ctx.get("values", [])
        strategic = ctx.get("strategic_perspective", [])
        senior_assess = ctx.get("senior_candidate_assessment", [])
        dual_focus = ctx.get("dual_agent_focus", "业务理解、技术判断力、团队影响力")
        dual_style = ctx.get("dual_agent_b_style", "")
        pain_points = ctx.get("current_pain_points", [])
        team_culture = ctx.get("team_specific_culture", [])

        strategic_section = ""
        if strategic:
            strategic_section = "\n## 战略视角\n" + "\n".join(f"- {s}" for s in strategic)

        senior_section = ""
        if senior_assess:
            senior_section = "\n## 高级候选人特殊考察\n" + "\n".join(f"- {s}" for s in senior_assess)

        pain_section = ""
        if pain_points:
            pain_section = "\n## 当前团队痛点（可作为讨论素材）\n" + "\n".join(f"- {p}" for p in pain_points)

        prompt = f"""# Role: {company} · {bu} 业务/战略面试官（{level}级 · Agent C）

## 你的身份
你是{company}{bu}的高级业务负责人（{level}级），负责从业务战略和软技能维度评估候选人。

## 公司文化
{culture if culture else '专业、严谨'}
{('价值观：' + ', '.join(values)) if values else ''}

## 团队文化
{chr(10).join('- ' + t for t in team_culture) if team_culture else '- 团队协作型文化'}
{strategic_section}
{senior_section}
{pain_section}

## 候选人信息
{cheat_sheet}

## 你的考察重点
- 核心关注：{dual_focus}
- 业务理解力：候选人如何将技术方案与业务目标对齐
- 团队协作：在冲突、技术选型争议中的处理方式
- 职业成熟度：职业规划与团队文化匹配度
- 提问方式偏向STAR法则（情境-任务-行动-结果）
{('- 面试风格：' + dual_style) if dual_style else ''}

## 重要规则
- 每次只问一个问题
- 问题要自然衔接上下文
- 如果之前Agent B的技术追问揭示了某些问题，你可以从业务角度跟进
- 语气温和但有洞察力
- 你与Agent B分工协作：你侧重业务判断和软技能，Agent B侧重技术深度

## 行为红线（严格禁止）
- 永远不要让候选人决定讨论话题或问题方向
- 不要说"你想聊哪个""你对哪方面更感兴趣"等开放式选择题
- 每次回复必须包含一个具体的追问或新问题
- 面试主导权完全在你手中
"""
        return prompt.strip()

    # ── Public Accessors ─────────────────────────────────────

    def get_bu_knowledge(self, company_key: str, bu_key: str, position_type: str) -> dict[str, Any]:
        """Get raw BU knowledge dict (used by orchestrator for tech areas)."""
        key = f"{company_key}_{bu_key}_{position_type}"
        return self._bu_knowledge.get(key, {})

    def get_level_config(self) -> dict[str, Any]:
        """Get the loaded level_config.yaml data."""
        return self._level_config

    # ── Legacy API (deprecated — kept for backward compatibility) ──

    def build_agent_b_prompt(
        self, company: str, bu: str, team: str, position: str, cheat_sheet: str
    ) -> str:
        """DEPRECATED: Use build() instead. Kept for backward compatibility."""
        logger.warning("build_agent_b_prompt() is deprecated, use build() instead")
        config = InterviewConfig(
            interview_id="legacy",
            company=company,
            business_unit=bu,
            team=team,
            position_type=position,
        )
        config.resume.interview_cheat_sheet = cheat_sheet
        return self.build(config, interviewer_level="T3", agent_role="agent_b")

    def build_agent_c_prompt(
        self, company: str, bu: str, team: str, position: str, cheat_sheet: str
    ) -> str:
        """DEPRECATED: Use build() instead. Kept for backward compatibility."""
        logger.warning("build_agent_c_prompt() is deprecated, use build() instead")
        config = InterviewConfig(
            interview_id="legacy",
            company=company,
            business_unit=bu,
            team=team,
            position_type=position,
        )
        config.resume.interview_cheat_sheet = cheat_sheet
        return self.build(config, interviewer_level="T3", agent_role="agent_c")
