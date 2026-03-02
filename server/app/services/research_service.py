"""
Research Service — Company Intelligence Pre-Research Orchestrator.

Manages the full research lifecycle:
  - Async execution of four research phases
  - In-memory cache (interview_id → ResearchBrief)
  - File persistence to research_output/{interview_id}/
  - Status polling for frontend progress display

Usage:
    # Trigger research (non-blocking)
    await research_service.start_research(
        interview_id="abc123",
        company="字节跳动",
        business_unit="抖音电商",
        position_type="backend",
        candidate_tech_stack=["Go", "Redis", "Kafka"],
    )

    # Poll status
    brief = research_service.get_brief(interview_id)
    # brief.status: "pending" | "phase1" | "phase2" | "phase3" | "completed" | "failed"
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Optional

from app.agents.research_agent import ResearchAgent
from app.models.schemas import ResearchBrief

logger = logging.getLogger(__name__)

# Output directory relative to the server working directory
_OUTPUT_ROOT = Path("research_output")


class ResearchService:
    """Singleton service managing all research tasks."""

    def __init__(self):
        self._cache: dict[str, ResearchBrief] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    # ── Public API ───────────────────────────────────────────

    async def start_research(
        self,
        interview_id: str,
        company: str,
        business_unit: str,
        position_type: str,
        candidate_tech_stack: list[str],
    ) -> ResearchBrief:
        """
        Kick off async research task. Returns immediately with a pending brief.
        The task runs in background and updates the cached brief as it progresses.
        """
        # If already running or completed, return existing
        existing = self._cache.get(interview_id)
        if existing and existing.status in ("phase1", "phase2", "phase3", "completed"):
            logger.info(f"[ResearchService] Returning cached brief for {interview_id} (status={existing.status})")
            return existing

        brief = ResearchBrief(
            interview_id=interview_id,
            company=company,
            business_unit=business_unit,
            position_type=position_type,
            status="pending",
            created_at=time.time(),
        )
        self._cache[interview_id] = brief

        # Fire-and-forget background task
        task = asyncio.create_task(
            self._run_research(brief, candidate_tech_stack),
            name=f"research-{interview_id}",
        )
        self._tasks[interview_id] = task
        task.add_done_callback(lambda t: self._on_task_done(interview_id, t))

        return brief

    def get_brief(self, interview_id: str) -> Optional[ResearchBrief]:
        """Return the current brief for an interview_id, or None if not started."""
        return self._cache.get(interview_id)

    def get_summary_for_prompt(self, interview_id: str) -> str:
        """Return the summary string to inject into system prompts.
        Returns empty string if research not completed or not available.
        """
        brief = self._cache.get(interview_id)
        if brief and brief.status == "completed" and brief.summary:
            return brief.summary
        return ""

    # ── Internal ─────────────────────────────────────────────

    async def _run_research(self, brief: ResearchBrief, candidate_tech_stack: list[str]) -> None:
        """Execute all four phases and persist results."""
        agent = ResearchAgent()
        out_dir = _OUTPUT_ROOT / brief.interview_id
        out_dir.mkdir(parents=True, exist_ok=True)

        try:
            # ── Phase 1 ──────────────────────────────────────
            brief.status = "phase1"
            logger.info(f"[ResearchService] {brief.interview_id}: starting Phase 1")
            phase1 = await agent.run_phase1(brief.company, brief.business_unit)
            brief.phase1_data = phase1
            self._save_json(out_dir / "phase1_version_intel.json", phase1)

            # ── Phase 2 ──────────────────────────────────────
            brief.status = "phase2"
            logger.info(f"[ResearchService] {brief.interview_id}: starting Phase 2")
            phase2 = await agent.run_phase2(brief.company, brief.business_unit)
            brief.phase2_data = phase2
            self._save_json(out_dir / "phase2_strategic_intel.json", phase2)

            # ── Phase 3 ──────────────────────────────────────
            brief.status = "phase3"
            logger.info(f"[ResearchService] {brief.interview_id}: starting Phase 3")
            phase3 = await agent.run_phase3(
                company=brief.company,
                business_unit=brief.business_unit,
                position_type=brief.position_type,
                candidate_tech_stack=candidate_tech_stack,
                phase1_data=phase1,
                phase2_data=phase2,
            )
            brief.phase3_data = phase3
            self._save_json(out_dir / "phase3_analysis.json", phase3)

            # ── Phase 4 ──────────────────────────────────────
            logger.info(f"[ResearchService] {brief.interview_id}: generating reports")
            full_report, summary = agent.build_reports(
                company=brief.company,
                business_unit=brief.business_unit,
                position_type=brief.position_type,
                candidate_tech_stack=candidate_tech_stack,
                phase1=phase1,
                phase2=phase2,
                phase3=phase3,
            )
            brief.full_report = full_report
            brief.summary = summary

            # Persist reports
            (out_dir / "interview_brief_full.md").write_text(full_report, encoding="utf-8")
            (out_dir / "interview_brief_summary.md").write_text(summary, encoding="utf-8")

            brief.status = "completed"
            logger.info(f"[ResearchService] {brief.interview_id}: research completed ✓")

        except Exception as e:
            brief.status = "failed"
            brief.error = str(e)
            logger.error(f"[ResearchService] {brief.interview_id}: research failed: {e}", exc_info=True)
            # Save error log
            self._save_json(out_dir / "error.json", {"error": str(e), "timestamp": time.time()})

    def _on_task_done(self, interview_id: str, task: asyncio.Task) -> None:
        """Clean up task reference when done."""
        self._tasks.pop(interview_id, None)
        if task.cancelled():
            brief = self._cache.get(interview_id)
            if brief and brief.status not in ("completed", "failed"):
                brief.status = "failed"
                brief.error = "Task was cancelled"

    @staticmethod
    def _save_json(path: Path, data: dict) -> None:
        try:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning(f"[ResearchService] Failed to save {path}: {e}")


# ── Singleton ─────────────────────────────────────────────────
research_service = ResearchService()
