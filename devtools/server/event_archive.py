"""
DevTools Event Archive — persistent event storage for replay/audit.

Design goals:
- Keep archive files in an isolated folder for easy management.
- Persist events permanently (JSONL append-only).
- Do not auto-read history on startup; only serve history on explicit API calls.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any


class EventArchive:
    """Append-only event archive with per-interview partitioning."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.interviews_root = self.root / "interviews"
        self.global_root = self.root / "global"
        self._lock = threading.Lock()
        self._active_interviews: set[str] = set()

        self.interviews_root.mkdir(parents=True, exist_ok=True)
        self.global_root.mkdir(parents=True, exist_ok=True)

    def record(self, event: dict[str, Any]) -> None:
        """Persist event to global stream and (when resolvable) interview stream."""
        with self._lock:
            ts = float(event.get("timestamp", time.time()))
            day = time.strftime("%Y-%m-%d", time.localtime(ts))
            self._append_jsonl(self.global_root / f"{day}.jsonl", event)

            interview_id = self._resolve_interview_id(event)
            if interview_id:
                interview_dir = self.interviews_root / interview_id
                interview_dir.mkdir(parents=True, exist_ok=True)
                events_file = interview_dir / "events.jsonl"
                self._append_jsonl(events_file, event)
                self._update_meta(interview_id, ts)

            self._update_active_interviews(event, interview_id)

    def list_interviews(self) -> list[dict[str, Any]]:
        """List all archived interviews (latest first)."""
        items: list[dict[str, Any]] = []
        for folder in self.interviews_root.iterdir():
            if not folder.is_dir():
                continue
            meta = folder / "meta.json"
            if meta.exists():
                try:
                    data = json.loads(meta.read_text(encoding="utf-8"))
                    items.append(data)
                    continue
                except Exception:
                    pass

            events_path = folder / "events.jsonl"
            count = 0
            first_ts = None
            last_ts = None
            if events_path.exists():
                try:
                    with events_path.open("r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            count += 1
                            ev = json.loads(line)
                            ts = float(ev.get("timestamp", 0.0) or 0.0)
                            if first_ts is None:
                                first_ts = ts
                            last_ts = ts
                except Exception:
                    pass

            items.append({
                "interview_id": folder.name,
                "event_count": count,
                "first_timestamp": first_ts,
                "last_timestamp": last_ts,
            })

        items.sort(key=lambda x: x.get("last_timestamp") or 0.0, reverse=True)
        return items

    def load_interview_events(self, interview_id: str, limit: int = 2000) -> list[dict[str, Any]]:
        """Load archived events of an interview (tail read, chronological return)."""
        path = self.interviews_root / interview_id / "events.jsonl"
        if not path.exists():
            return []

        lines: list[str] = []
        try:
            with path.open("r", encoding="utf-8") as f:
                lines = [ln.strip() for ln in f if ln.strip()]
        except Exception:
            return []

        if limit > 0 and len(lines) > limit:
            lines = lines[-limit:]

        out: list[dict[str, Any]] = []
        for ln in lines:
            try:
                out.append(json.loads(ln))
            except Exception:
                continue
        return out

    def _resolve_interview_id(self, event: dict[str, Any]) -> str | None:
        sid = str(event.get("session_id", "") or "").strip()
        if sid:
            return sid

        payload = event.get("payload")
        if isinstance(payload, dict):
            candidate = payload.get("interview_id")
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()

        if len(self._active_interviews) == 1:
            return next(iter(self._active_interviews))

        return None

    def _update_active_interviews(self, event: dict[str, Any], resolved_interview_id: str | None) -> None:
        etype = str(event.get("type", ""))
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        sid = str(event.get("session_id", "") or "").strip()

        if etype == "session_start":
            candidate = sid or str(payload.get("interview_id", "") or "").strip()
            if candidate:
                self._active_interviews.add(candidate)
            return

        if etype in {"session_end", "ws_disconnected"}:
            candidate = sid or str(payload.get("interview_id", "") or "").strip()
            if candidate:
                self._active_interviews.discard(candidate)
            return

        if resolved_interview_id:
            self._active_interviews.add(resolved_interview_id)

    def _append_jsonl(self, file_path: Path, data: dict[str, Any]) -> None:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with file_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(data, ensure_ascii=False))
            f.write("\n")

    def _update_meta(self, interview_id: str, ts: float) -> None:
        meta_file = self.interviews_root / interview_id / "meta.json"

        old = {
            "interview_id": interview_id,
            "event_count": 0,
            "first_timestamp": ts,
            "last_timestamp": ts,
            "updated_at": time.time(),
        }
        if meta_file.exists():
            try:
                old = json.loads(meta_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        old["interview_id"] = interview_id
        old["event_count"] = int(old.get("event_count", 0)) + 1
        old["first_timestamp"] = old.get("first_timestamp", ts)
        old["last_timestamp"] = ts
        old["updated_at"] = time.time()

        meta_file.write_text(
            json.dumps(old, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


archive = EventArchive(root=Path(__file__).parent.parent / "event_archive")
