"""
AI Interview Server — FastAPI Application Entry Point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.ws_interview import router as ws_router
from app.api.rest import router as rest_router

app = FastAPI(
    title="AI模拟面试服务",
    version="0.1.0",
    description="企业级AI模拟面试系统 — 云端服务",
)

# CORS — dev (localhost:5173), Electron packaged (file://), production
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "file://",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(ws_router)
app.include_router(rest_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
