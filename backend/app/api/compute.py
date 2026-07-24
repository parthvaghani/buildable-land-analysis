"""POST /compute — core buildable-area endpoint."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from shapely.geometry import shape
from shapely.geometry import mapping as shapely_mapping

from app.core.cache import constraint_store
from app.core.config import get_config
from app.core.geometry import (
    WORKING_CRS,
    compute_buildable,
    reproject_geom,
)
from app.core.loader import get_parcel_by_id, get_parcels_gdf

router = APIRouter(tags=["compute"])


# ---------------------------------------------------------------------------
# Request / response schemas (Pydantic v2)
# ---------------------------------------------------------------------------


class BufferOverrides(BaseModel):
    wetland_ft: float = Field(default=50.0, ge=0)
    floodplain_ft: float = Field(default=0.0, ge=0)
    easement_ft: float = Field(default=100.0, ge=0)
    building_ft: float = Field(default=10.0, ge=0)


class ComputeRequest(BaseModel):
    parcel_id: str
    buffers: BufferOverrides = Field(default_factory=BufferOverrides)
    carve_outs: list[dict[str, Any]] = Field(
        default_factory=list,
        description="List of GeoJSON Polygon objects (EPSG:4326) to additionally exclude.",
    )
    restores: list[dict[str, Any]] = Field(
        default_factory=list,
        description=(
            "List of GeoJSON Polygon objects (EPSG:4326) to add back. "
            "Hard constraint areas cannot be restored."
        ),
    )


class BreakdownItem(BaseModel):
    type: str
    acres_removed: float
    source: str


class ComputeResponse(BaseModel):
    buildable_geojson: dict[str, Any]
    # parcel − buildable, so the map can shade what was removed without inferring
    # it from the two other polygons.  None when nothing was removed.
    excluded_geojson: dict[str, Any] | None = None
    buildable_acres: float
    total_parcel_acres: float
    breakdown: list[BreakdownItem]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/compute", response_model=ComputeResponse)
async def compute_endpoint(req: ComputeRequest) -> ComputeResponse:
    """
    Compute buildable area for a parcel given buffer distances and optional
    user-drawn carve-outs / restores.

    Guarantee: sum(breakdown[].acres_removed) == total_parcel_acres - buildable_acres
    """
    # 1. Fetch parcel geometry in working CRS.
    parcel_dict = get_parcel_by_id(req.parcel_id)
    if parcel_dict is None:
        raise HTTPException(status_code=404, detail=f"Parcel '{req.parcel_id}' not found.")

    gdf = get_parcels_gdf()
    mask = gdf["parcel_id"] == req.parcel_id
    parcel_geom_working = gdf[mask].iloc[0].geometry  # already in WORKING_CRS

    # 2. Resolve buffer distances — request body overrides config defaults.
    cfg = get_config()
    buffer_ft = {
        "wetland_ft": req.buffers.wetland_ft,
        "floodplain_ft": req.buffers.floodplain_ft,
        "easement_ft": req.buffers.easement_ft,
        "building_ft": req.buffers.building_ft,
    }

    # 3. Fetch constraint geometries for this parcel (cached after first call).
    constraint_geoms_raw = constraint_store.get_parcel_constraints(
        parcel_id=req.parcel_id,
        parcel_geom=parcel_geom_working,
        buffer_distances_ft=buffer_ft,
    )

    # 4. Build source lookup from config.
    sources = {cl.name: cl.source for cl in cfg.constraint_layers}

    # 5. Reproject user-drawn polygons from EPSG:4326 → working CRS.
    def _geojson_to_working(geojson: dict) -> Any:
        geom_4326 = shape(geojson)
        return reproject_geom(geom_4326, "EPSG:4326", WORKING_CRS)

    carve_outs_working = [_geojson_to_working(co) for co in req.carve_outs]
    restores_working = [_geojson_to_working(rs) for rs in req.restores]

    # 6. Core computation.
    result = compute_buildable(
        parcel_geom=parcel_geom_working,
        constraint_geometries=constraint_geoms_raw,
        buffer_distances_ft=buffer_ft,
        sources=sources,
        carve_outs=carve_outs_working,
        restores=restores_working,
    )

    # 7. Reproject buildable geometry back to EPSG:4326 for the GeoJSON response.
    buildable_4326 = reproject_geom(result.buildable_geom, WORKING_CRS, "EPSG:4326")

    # Derive the excluded footprint from the same geometries the acreage came
    # from, so the shaded area and the breakdown can never disagree.
    excluded_working = parcel_geom_working.difference(result.buildable_geom)
    excluded_4326 = (
        reproject_geom(excluded_working, WORKING_CRS, "EPSG:4326")
        if not excluded_working.is_empty
        else None
    )

    breakdown_items = [
        BreakdownItem(type=row.type, acres_removed=row.acres_removed, source=row.source)
        for row in result.breakdown
    ]

    return ComputeResponse(
        buildable_geojson=dict(shapely_mapping(buildable_4326)),
        excluded_geojson=(
            dict(shapely_mapping(excluded_4326)) if excluded_4326 is not None else None
        ),
        buildable_acres=result.buildable_acres,
        total_parcel_acres=result.total_parcel_acres,
        breakdown=breakdown_items,
    )
