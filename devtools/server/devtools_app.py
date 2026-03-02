"""
DevTools FastAPI App — Runs on port 8001 alongside the main app (port 8000).

Endpoints:
  GET  /devtools/health                    — health check
  WS   /devtools/ws                        — real-time event stream
  GET  /devtools/sessions                  — list active sessions
  GET  /devtools/session/{id}/blackboard   — full blackboard snapshot
  GET  /devtools/research/{id}             — research output files
  GET  /devtools/research/{id}/{filename}  — individual research file content
"""
from __future__ import annotations

import asyncio
import importlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from devtools.server.event_archive import archive

logger = logging.getLogger("devtools.app")


def _get_session_mgr():
    mod = importlib.import_module("app.api.ws_interview")
    return getattr(mod, "session_mgr")

devtools_app = FastAPI(
    title="AI Interview DevTools",
    version="1.0.0",
    description="Developer monitoring panel for AI Interview system",
)

devtools_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Health ──────────────────────────────────────────────────

@devtools_app.get("/devtools/health")
async def health():
    return {"status": "ok", "service": "devtools", "timestamp": time.time()}


@devtools_app.get("/devtools/archive/interviews")
async def list_archived_interviews(limit: int = 200):
    """List archived interviews for replay. Not used by startup flow."""
    try:
        rows = archive.list_interviews()
        if limit > 0:
            rows = rows[:limit]
        return {
            "count": len(rows),
            "interviews": rows,
            "archive_root": str(archive.root),
            "timestamp": time.time(),
        }
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


@devtools_app.get("/devtools/archive/{interview_id}")
async def replay_archived_interview(interview_id: str, limit: int = 3000):
    """Load archived events for a specific interview id (manual replay only)."""
    try:
        events = archive.load_interview_events(interview_id=interview_id, limit=limit)
        return {
            "interview_id": interview_id,
            "count": len(events),
            "events": events,
            "timestamp": time.time(),
        }
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


# ── WebSocket event stream ───────────────────────────────────

@devtools_app.websocket("/devtools/ws")
async def devtools_ws(ws: WebSocket):
    """Real-time event stream. Each message is a JSON event from the event bus."""
    await ws.accept()
    logger.info("DevTools client connected")

    from devtools.server.event_bus import bus
    queue = bus.subscribe()

    try:
        # Send a welcome event so the client knows the connection is live
        await ws.send_json({
            "type": "devtools_connected",
            "timestamp": time.time(),
            "session_id": "",
            "payload": {"message": "DevTools event stream connected"},
        })

        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=25.0)
                await ws.send_json(event)
            except asyncio.TimeoutError:
                # Send a keepalive ping
                await ws.send_json({
                    "type": "keepalive",
                    "timestamp": time.time(),
                    "session_id": "",
                    "payload": {},
                })
    except WebSocketDisconnect:
        logger.info("DevTools client disconnected")
    except Exception as exc:
        logger.warning(f"DevTools WS error: {exc}")
    finally:
        bus.unsubscribe(queue)


# ── Session snapshots ────────────────────────────────────────

@devtools_app.get("/devtools/sessions")
async def list_sessions():
    """List all active interview sessions."""
    try:
        session_mgr = _get_session_mgr()
        sessions = []
        for sid, sess in session_mgr._sessions.items():
            bb = sess.blackboard
            cfg = bb.config
            sessions.append({
                "interview_id": sid,
                "company": cfg.company,
                "round": cfg.round,
                "target_level": cfg.target_level,
                "current_mode": bb.current_mode.value,
                "total_questions": bb.total_questions,
                "elapsed_minutes": round(bb.elapsed_minutes, 1),
                "is_active": sess._is_active,
            })
        return {"sessions": sessions, "count": len(sessions)}
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


@devtools_app.get("/devtools/session/{interview_id}/blackboard")
async def get_blackboard(interview_id: str):
    """Return full blackboard state for a session."""
    try:
        session_mgr = _get_session_mgr()
        sess = session_mgr._sessions.get(interview_id)
        if not sess:
            return JSONResponse({"error": "session not found"}, status_code=404)

        bb = sess.blackboard
        data = bb.model_dump(mode="json")

        # Truncate huge system prompts for readability
        if "agent_b_system_prompt" in data and data["agent_b_system_prompt"]:
            sp = data["agent_b_system_prompt"]
            data["agent_b_system_prompt_chars"] = len(sp)
            data["agent_b_system_prompt"] = sp[:2000] + ("..." if len(sp) > 2000 else "")
        if "agent_c_system_prompt" in data and data["agent_c_system_prompt"]:
            sp = data["agent_c_system_prompt"]
            data["agent_c_system_prompt_chars"] = len(sp)
            data["agent_c_system_prompt"] = sp[:2000] + ("..." if len(sp) > 2000 else "")

        return {"interview_id": interview_id, "blackboard": data, "timestamp": time.time()}
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


@devtools_app.get("/devtools/session/{interview_id}/messages")
async def get_messages(interview_id: str):
    """Return full conversation history for a session."""
    try:
        session_mgr = _get_session_mgr()
        sess = session_mgr._sessions.get(interview_id)
        if not sess:
            return JSONResponse({"error": "session not found"}, status_code=404)
        return {
            "interview_id": interview_id,
            "messages": sess.blackboard.messages,
            "count": len(sess.blackboard.messages),
        }
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


@devtools_app.get("/devtools/session/{interview_id}/evaluations")
async def get_evaluations(interview_id: str):
    """Return all evaluation memory items for a session."""
    try:
        session_mgr = _get_session_mgr()
        sess = session_mgr._sessions.get(interview_id)
        if not sess:
            return JSONResponse({"error": "session not found"}, status_code=404)
        items = [e.model_dump(mode="json") for e in sess.blackboard.evaluation_memory]
        return {
            "interview_id": interview_id,
            "evaluations": items,
            "count": len(items),
        }
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


# ── Research output ──────────────────────────────────────────

def _research_root() -> Path:
    """Resolve the research_output directory."""
    here = Path(__file__).parent  # devtools/server/
    candidates = [
        here.parent.parent / "server" / "research_output",  # d:\APP\server\research_output
        Path("server") / "research_output",
        Path("research_output"),
    ]
    for p in candidates:
        if p.exists():
            return p
    return candidates[0]


@devtools_app.get("/devtools/research")
async def list_research():
    """List all research output folders."""
    root = _research_root()
    if not root.exists():
        return {"folders": [], "root": str(root)}
    folders = [d.name for d in sorted(root.iterdir()) if d.is_dir()]
    return {"folders": folders, "root": str(root)}


@devtools_app.get("/devtools/research/{interview_id}")
async def get_research(interview_id: str):
    """List files in a research output folder."""
    root = _research_root()
    folder = root / interview_id
    if not folder.exists():
        return JSONResponse({"error": "research folder not found"}, status_code=404)
    files: dict[str, Any] = {}
    for f in folder.iterdir():
        if f.is_file():
            stat = f.stat()
            files[f.name] = {
                "size_bytes": stat.st_size,
                "modified": stat.st_mtime,
            }
    return {"interview_id": interview_id, "files": files}


@devtools_app.get("/devtools/research/{interview_id}/{filename}")
async def get_research_file(interview_id: str, filename: str):
    """Return the content of a specific research output file."""
    root = _research_root()
    filepath = root / interview_id / filename
    if not filepath.exists():
        return JSONResponse({"error": "file not found"}, status_code=404)
    content = filepath.read_text(encoding="utf-8")
    if filename.endswith(".json"):
        try:
            return {"interview_id": interview_id, "filename": filename, "content": json.loads(content)}
        except json.JSONDecodeError:
            pass
    return {"interview_id": interview_id, "filename": filename, "content": content}
