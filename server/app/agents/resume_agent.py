"""
Resume Preprocessor Agent.

Parses raw resume text into a structured JSON document
using LLM, then generates an interview cheat sheet.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.services.llm_service import llm_complete

logger = logging.getLogger(__name__)

RESUME_PARSE_PROMPT = """
你是一名专业的技术招聘HR，擅长提取简历关键信息。
请将以下简历解析为结构化数据，重点关注技术项目。

输出严格JSON格式：
{
    "candidate_profile": {
        "name": "姓名",
        "years_exp": "工作年限",
        "education": "学历背景",
        "current_role": "当前职位",
        "skill_tags": ["技能标签"]
    },
    "projects": [
        {
            "index": 0,
            "name": "项目名称",
            "role": "担任角色",
            "duration": "时间",
            "tech_stack": ["技术栈"],
            "key_metrics": {"qps": "10万", "latency": "50ms"},
            "business_context": "业务背景（电商/社交等）",
            "technical_highlights": ["技术亮点"],
            "suspicious_points": ["可疑点，如：3人团队说做微服务"],
            "drill_suggestions": ["建议深挖点"]
        }
    ],
    "career_trajectory": "职业路径分析（转行/晋升/跳槽）",
    "red_flags": ["风险点：如频繁跳槽、技术栈跳跃"],
    "interview_focus": ["建议面试重点"]
}

规则：
1. 量化所有性能指标（QPS/TPS/RT/DAU等）
2. 标记可疑的技术选型（如小团队过度设计）
3. 为每个项目生成3个可能的深挖问题建议
4. 如果简历模糊，标记"需要澄清"
5. 确保输出是合法的JSON
""".strip()


class ResumePreprocessor:
    """简历结构化解析Agent"""

    async def parse(self, raw_resume: str) -> dict[str, Any]:
        """Parse raw resume text into structured data."""
        messages = [
            {"role": "system", "content": RESUME_PARSE_PROMPT},
            {"role": "user", "content": raw_resume},
        ]

        try:
            response = await llm_complete(
                messages=messages,
                temperature=0.3,
                max_tokens=4096,
                module="resume",
            )

            structured = await self._parse_json_with_repair(response)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse resume JSON after repair: {e}")
            raise RuntimeError("简历解析失败：模型输出不是合法JSON，请重试或切换模型") from e
        except Exception as e:
            logger.error(f"Resume parse error: {e}")
            raise

        # Generate cheat sheet
        structured["interview_cheat_sheet"] = self._generate_cheat_sheet(structured)
        return structured

    async def _parse_json_with_repair(self, raw_response: str) -> dict[str, Any]:
        """Parse model response into JSON with one automatic repair retry."""
        json_candidate = self._extract_json_candidate(raw_response)
        try:
            return json.loads(json_candidate)
        except json.JSONDecodeError:
            repaired_text = await self._repair_json_once(json_candidate)
            repaired_candidate = self._extract_json_candidate(repaired_text)
            return json.loads(repaired_candidate)

    def _extract_json_candidate(self, text: str) -> str:
        """Extract probable JSON block from plain text / markdown fenced content."""
        if not text:
            return ""

        cleaned = text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(
                line for line in lines if not line.strip().startswith("```")
            ).strip()

        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            return cleaned[start:end + 1]
        return cleaned

    async def _repair_json_once(self, bad_json_text: str) -> str:
        """Ask LLM to repair malformed JSON and return strict JSON only."""
        repair_prompt = (
            "你是JSON修复器。请把下面内容修复为严格合法JSON。"
            "禁止输出解释、禁止markdown代码块，只输出JSON对象本体。\n\n"
            f"内容：\n{bad_json_text[:6000]}"
        )
        return await llm_complete(
            messages=[
                {"role": "system", "content": "你只输出严格合法JSON，不输出任何解释文本。"},
                {"role": "user", "content": repair_prompt},
            ],
            temperature=0.1,
            max_tokens=4096,
            module="resume",
        )

    def _generate_cheat_sheet(self, data: dict) -> str:
        """Generate a quick reference card for interview agents."""
        profile = data.get("candidate_profile", {})
        cheat = f"【候选人速查】{profile.get('name', '?')} | {profile.get('years_exp', '?')}经验\n"
        cheat += f"学历：{profile.get('education', '?')} | 当前：{profile.get('current_role', '?')}\n"
        cheat += f"技能：{', '.join(profile.get('skill_tags', [])[:6])}\n\n"
        cheat += "项目清单：\n"

        for p in data.get("projects", []):
            cheat += f"\n[{p.get('index', '?')}] {p.get('name', '?')} ({p.get('duration', '?')})\n"
            cheat += f"   角色：{p.get('role', '?')} | 业务：{p.get('business_context', '?')}\n"
            cheat += f"   技术：{', '.join(p.get('tech_stack', [])[:4])}\n"
            metrics = p.get('key_metrics', {})
            if metrics:
                cheat += f"   关键数据：{json.dumps(metrics, ensure_ascii=False)}\n"
            drills = p.get('drill_suggestions', [])
            if drills:
                cheat += f"   深挖建议：{drills[0]}\n"
            sus = p.get('suspicious_points', [])
            if sus:
                cheat += f"   ⚠️ 注意：{sus[0]}\n"

        red_flags = data.get("red_flags", [])
        if red_flags:
            cheat += f"\n🚩 风险点：{'; '.join(red_flags)}\n"

        focus = data.get("interview_focus", [])
        if focus:
            cheat += f"🎯 面试重点：{'; '.join(focus)}\n"

        return cheat
