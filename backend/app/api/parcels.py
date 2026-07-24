"""GET /parcels  and  GET /parcels/{id}"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.core.loader import get_parcel_by_id, get_parcels_page

router = APIRouter(tags=["parcels"])


@router.get("/parcels")
async def list_parcels(
    bbox: str | None = Query(
        default=None,
        description="minx,miny,maxx,maxy in EPSG:4326 (WGS 84 lon/lat)",
    ),
    q: str | None = Query(
        default=None,
        description="Case-insensitive substring match on parcel ID, owner, address, or legal description.",
    ),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """
    Return a paginated list of parcels, optionally filtered by bounding box and
    free-text query.  Both filters run server-side across every parcel, so search
    is not limited to whatever page the client happens to have loaded.

    Response matches the Milestone 2 contract exactly:
    { parcels: [{id, geometry, area_acres, attributes}], total_count }
    """
    parsed_bbox = None
    if bbox:
        try:
            parts = [float(v) for v in bbox.split(",")]
            if len(parts) != 4:
                raise ValueError
            parsed_bbox = tuple(parts)
        except ValueError:
            raise HTTPException(status_code=422, detail="bbox must be 'minx,miny,maxx,maxy' floats")

    parcels, total = get_parcels_page(parsed_bbox, limit=limit, offset=offset, query=q)
    return {"parcels": parcels, "total_count": total}


@router.get("/parcels/{parcel_id}")
async def get_parcel(parcel_id: str) -> dict[str, Any]:
    """Return a single parcel by its ID."""
    parcel = get_parcel_by_id(parcel_id)
    if parcel is None:
        raise HTTPException(status_code=404, detail=f"Parcel '{parcel_id}' not found.")
    return parcel
