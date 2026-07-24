"""
Buildable Land Analysis — FastAPI application entry point.

Start with:
    uvicorn app.main:app --reload          # development
    gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 2  # production
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import compute, config_router, constraint_features, constraints, parcels
from app.core.loader import load_all

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Loading spatial data from GeoParquet files…")
    try:
        load_all()
    except Exception as exc:
        log.error("Startup data load failed: %s", exc)
        log.warning("Server will start but endpoints may return empty results until data is ingested.")
    yield
    log.info("Shutdown complete.")


app = FastAPI(
    title="Buildable Land Analysis API",
    description=(
        "Computes buildable area for a parcel by subtracting regulated constraint zones "
        "(wetlands, floodplain, transmission easements, existing buildings) with configurable setbacks."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow the Milestone 2 frontend dev server.
_origins_raw = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000")
origins = [o.strip() for o in _origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(parcels.router)
app.include_router(constraints.router)
app.include_router(constraint_features.router)
app.include_router(config_router.router)
app.include_router(compute.router)


@app.get("/health", tags=["meta"])
async def health() -> dict:
    return {"status": "ok"}
