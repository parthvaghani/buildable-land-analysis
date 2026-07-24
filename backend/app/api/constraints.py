"""GET /constraints"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.cache import constraint_store
from app.core.config import get_config

router = APIRouter(tags=["constraints"])


@router.get("/constraints")
async def list_constraints() -> dict:
    """
    Return metadata for all configured constraint layers.

    `feature_count` reflects what actually loaded at startup, so a layer that is
    configured but whose ingest failed reports 0 rather than appearing available.
    """
    cfg = get_config()
    layers = []
    for cl in cfg.constraint_layers:
        gdf = constraint_store.get_layer(cl.name)
        layers.append(
            {
                "name": cl.name,
                "type": cl.type,
                "default_buffer_ft": cl.default_buffer_ft,
                "source": cl.source,
                "feature_count": 0 if gdf is None else len(gdf),
            }
        )
    return {"layers": layers}
