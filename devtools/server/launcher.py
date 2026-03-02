"""
DevTools Launcher — Starts both main app (port 8000) and DevTools app (port 8001)
in the same Python process.

Usage (from repo root):
    python -m devtools.server.launcher

The launch order:
  1. Add server/ to sys.path
  2. Import all app modules (triggers module-level code)
  3. Install DevTools monkey-patches (spy.install_patches)
  4. Run both uvicorn servers concurrently via asyncio.gather
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

# ── Path setup ───────────────────────────────────────────────
_ROOT = Path(__file__).parent.parent.parent  # d:\APP
_SERVER = _ROOT / "server"

if str(_SERVER) not in sys.path:
    sys.path.insert(0, str(_SERVER))

# devtools/ itself must also be on path
_DEVTOOLS_PARENT = _ROOT
if str(_DEVTOOLS_PARENT) not in sys.path:
    sys.path.insert(0, str(_DEVTOOLS_PARENT))

# ── Logging bootstrap ────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("devtools.launcher")

# ── Change cwd to server/ so app can find its relative paths ─
os.chdir(_SERVER)


def main() -> None:
    logger.info("=" * 60)
    logger.info("  AI Interview DevTools Launcher")
    logger.info(f"  Main app  → http://localhost:8000")
    logger.info(f"  DevTools  → http://localhost:8001")
    logger.info("=" * 60)

    # 1. Import app modules FIRST (before patching)
    logger.info("Importing app modules...")
    import app.main as _main_mod
    from app.services import llm_service as _  # noqa
    from app.agents import orchestrator as _  # noqa
    from app.services import session_manager as _  # noqa

    # 2. Install DevTools patches
    logger.info("Installing DevTools patches...")
    from devtools.server.spy import install_patches
    install_patches()

    # 3. Import DevTools app (after bus is ready)
    from devtools.server.devtools_app import devtools_app

    # 4. Run both servers
    asyncio.run(_serve_both(_main_mod.app, devtools_app))


async def _serve_both(main_app, devtools_app) -> None:
    import uvicorn

    config_main = uvicorn.Config(
        app=main_app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        reload=False,  # reload not supported with programmatic launch
    )
    config_dev = uvicorn.Config(
        app=devtools_app,
        host="0.0.0.0",
        port=8001,
        log_level="info",
        reload=False,
    )

    server_main = uvicorn.Server(config_main)
    server_dev = uvicorn.Server(config_dev)

    # Prevent uvicorn from installing its own signal handlers twice
    server_main.install_signal_handlers = lambda: None  # type: ignore[method-assign]

    logger.info("Starting both servers...")
    await asyncio.gather(
        server_main.serve(),
        server_dev.serve(),
    )


if __name__ == "__main__":
    main()
