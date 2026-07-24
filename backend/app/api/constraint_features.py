"""
GET /constraint-features?parcel_id=X

Returns raw (un-buffered) constraint geometries that intersect the given
parcel, reprojected to EPSG:4326 for GeoJSON rendering in the frontend.

This endpoint exists to support the map-overlay feature in the frontend
(Section 6.1 of the Milestone 2 spec) — it lets users see the underlying
constraint geometry and understand *why* an area was excluded, rather than
only seeing the final excluded polygon.

Not part of the core compute contract — purely a frontend-support endpoint.
"""

from __future__ import annotations

from typing import Any

import pyproj
from fastapi import APIRouter, HTTPException, Query
from shapely.geometry import mapping
from shapely.ops import transform

from app.core.cache import constraint_store
from app.core.geometry import WORKING_CRS
from app.core.loader import get_parcels_gdf

router = APIRouter(tags=["constraint-features"])

_transformer_to_4326 = pyproj.Transformer.from_crs(
    WORKING_CRS, "EPSG:4326", always_xy=True
)


def _to_4326(geom: Any) -> Any:
    return transform(_transformer_to_4326.transform, geom)


def _safe_props(row: Any) -> dict:
    """Convert a GeoDataFrame row to JSON-safe property dict."""
    props: dict = {}
    for k, v in row.items():
        if k == "geometry":
            continue
        try:
            if hasattr(v, "item"):
                v = v.item()
            props[k] = v if isinstance(v, (str, int, float, bool, type(None))) else str(v)
        except Exception:
            props[k] = None
    return props


@router.get("/constraint-features")
async def get_constraint_features(
    parcel_id: str = Query(..., description="Parcel ID to fetch constraint geometry for"),
) -> dict[str, Any]:
    """
    Return raw constraint geometries (wetland, floodplain, easement, building)
    intersecting the given parcel, in EPSG:4326 GeoJSON.

    Response:
    {
      "layers": {
        "wetland":    { "type": "FeatureCollection", "features": [...] },
        "floodplain": { "type": "FeatureCollection", "features": [...] },
        "easement":   { "type": "FeatureCollection", "features": [...] },
        "building":   { "type": "FeatureCollection", "features": [...] }
      }
    }
    """
    gdf = get_parcels_gdf()
    mask = gdf["parcel_id"] == parcel_id
    if not mask.any():
        raise HTTPException(status_code=404, detail=f"Parcel '{parcel_id}' not found.")

    parcel_geom = gdf[mask].iloc[0].geometry

    layers: dict[str, Any] = {}

    for layer_name in constraint_store.layer_names():
        layer_gdf = constraint_store.get_layer(layer_name)

        if layer_gdf is None or layer_gdf.empty:
            layers[layer_name] = {"type": "FeatureCollection", "features": []}
            continue

        candidate_idx = list(layer_gdf.sindex.intersection(parcel_geom.bounds))
        if not candidate_idx:
            layers[layer_name] = {"type": "FeatureCollection", "features": []}
            continue

        candidates = layer_gdf.iloc[candidate_idx]
        hits = candidates[candidates.intersects(parcel_geom)]

        if hits.empty:
            layers[layer_name] = {"type": "FeatureCollection", "features": []}
            continue

        features: list[dict] = []
        for _, row in hits.iterrows():
            try:
                clipped = row.geometry.intersection(parcel_geom)
                if clipped.is_empty:
                    continue
                geom_4326 = _to_4326(clipped)
                features.append(
                    {
                        "type": "Feature",
                        "geometry": mapping(geom_4326),
                        "properties": _safe_props(row),
                    }
                )
            except Exception:
                continue

        layers[layer_name] = {"type": "FeatureCollection", "features": features}

    return {"layers": layers}
