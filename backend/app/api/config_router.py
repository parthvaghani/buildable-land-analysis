"""GET /config"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.config import get_config

router = APIRouter(tags=["config"])


@router.get("/config")
async def get_buffer_config() -> dict:
    """
    Return the current default buffer configuration from config.yaml.

    Response contract (Milestone 2 depends on these exact field names):
    { wetland_ft, floodplain_ft, easement_ft, building_ft }
    """
    cfg = get_config()
    b = cfg.buffers
    return {
        "wetland_ft": b.wetland_ft,
        "floodplain_ft": b.floodplain_ft,
        "easement_ft": b.easement_ft,
        "building_ft": b.building_ft,
    }
