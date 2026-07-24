"""
Startup loader: reads GeoParquet files from data/processed/ into GeoDataFrames
and registers them with the ConstraintStore and parcel index.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd

from app.core.cache import constraint_store
from app.core.config import get_config
from app.core.geometry import WORKING_CRS, reproject_gdf

log = logging.getLogger(__name__)

# Module-level parcel GeoDataFrame (all parcels, in working CRS).
_parcels_gdf: gpd.GeoDataFrame | None = None

# Lower-cased "id + owner + address + legal description" text per parcel, used by
# the ?q= search.  Held as a Series aligned to _parcels_gdf rather than a column
# so it cannot leak into the `attributes` payload, and built once at startup so a
# keystroke costs one substring scan instead of re-stringifying 117k rows.
_parcel_search_index: "pd.Series | None" = None

# Attribute columns worth searching, in the order a user is likely to mean them.
SEARCHABLE_COLUMNS = ("parcel_id", "OWNER_NAME", "SITUS_ADDR", "LEGAL_DESC")


def load_all() -> None:
    """Load parcels and all constraint layers at server startup."""
    cfg = get_config()
    pd = cfg.processed_dir

    _load_parcels(pd / "parcels.parquet")

    layer_files = {
        "wetland": pd / "wetlands.parquet",
        "floodplain": pd / "flood_zones.parquet",
        "easement": pd / "easements.parquet",
        "building": pd / "buildings.parquet",
    }
    for name, path in layer_files.items():
        _load_constraint(name, path)

    log.info("Startup load complete — %d parcels in memory.", len(_parcels_gdf) if _parcels_gdf is not None else 0)


def _load_parcels(path: Path) -> None:
    global _parcels_gdf, _parcel_search_index
    if not path.exists():
        log.warning("Parcel file not found: %s — run ingest_parcels.py first.", path)
        _parcels_gdf = gpd.GeoDataFrame(columns=["parcel_id", "geometry", "area_acres"], crs=WORKING_CRS)
        _parcel_search_index = pd.Series(dtype=str)
        return
    gdf = gpd.read_parquet(path)
    gdf = reproject_gdf(gdf, WORKING_CRS)
    gdf = _ensure_parcel_id(gdf)
    _ = gdf.sindex  # build spatial index
    _parcels_gdf = gdf
    _parcel_search_index = _build_search_index(gdf)
    log.info("Loaded %d parcels from %s", len(gdf), path)


def _build_search_index(gdf: gpd.GeoDataFrame) -> pd.Series:
    """Concatenate the searchable columns per row, lower-cased, for substring search."""
    present = [c for c in SEARCHABLE_COLUMNS if c in gdf.columns]
    if not present:
        return pd.Series("", index=gdf.index, dtype=str)

    blob = gdf[present[0]].astype(str)
    for col in present[1:]:
        blob = blob + " " + gdf[col].astype(str)
    return blob.str.lower()


def _load_constraint(name: str, path: Path) -> None:
    if not path.exists():
        log.warning("Constraint layer '%s' not found at %s — skipping.", name, path)
        return
    gdf = gpd.read_parquet(path)
    constraint_store.register(name, gdf)
    log.info("Loaded constraint layer '%s' (%d features) from %s", name, len(gdf), path)


def _ensure_parcel_id(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Ensure a stable string parcel_id column exists."""
    if "parcel_id" not in gdf.columns:
        if "GEO_ID" in gdf.columns:
            gdf = gdf.rename(columns={"GEO_ID": "parcel_id"})
        elif "PROP_ID" in gdf.columns:
            gdf = gdf.rename(columns={"PROP_ID": "parcel_id"})
        else:
            gdf = gdf.copy()
            gdf["parcel_id"] = gdf.index.astype(str)
    gdf["parcel_id"] = gdf["parcel_id"].astype(str)
    return gdf


# ---------------------------------------------------------------------------
# Parcel accessors used by API routers
# ---------------------------------------------------------------------------


def get_parcels_gdf() -> gpd.GeoDataFrame:
    global _parcels_gdf
    if _parcels_gdf is None:
        raise RuntimeError("Parcel data not loaded — call load_all() first.")
    return _parcels_gdf


def get_parcel_by_id(parcel_id: str) -> dict[str, Any] | None:
    gdf = get_parcels_gdf()
    mask = gdf["parcel_id"] == parcel_id
    if not mask.any():
        return None
    row = gdf[mask].iloc[0]
    return _parcel_row_to_dict(row)


def get_parcels_page(
    bbox: tuple[float, float, float, float] | None,
    limit: int,
    offset: int,
    query: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    gdf = get_parcels_gdf()

    if bbox is not None:
        minx, miny, maxx, maxy = bbox
        # bbox is expected in EPSG:4326 from the client; reproject bounds to working CRS.
        import pyproj
        from shapely.geometry import box

        transformer = pyproj.Transformer.from_crs("EPSG:4326", WORKING_CRS, always_xy=True)
        bx1, by1 = transformer.transform(minx, miny)
        bx2, by2 = transformer.transform(maxx, maxy)
        bbox_geom = box(bx1, by1, bx2, by2)
        candidate_idx = list(gdf.sindex.intersection(bbox_geom.bounds))
        gdf = gdf.iloc[candidate_idx]
        gdf = gdf[gdf.intersects(bbox_geom)]

    # Applied after the bbox filter so the spatial index is still used against the
    # full frame; the search index is label-aligned, so it survives the subsetting.
    if query and query.strip() and _parcel_search_index is not None:
        needle = query.strip().lower()
        haystack = _parcel_search_index.reindex(gdf.index)
        gdf = gdf[haystack.str.contains(needle, na=False, regex=False)]

    total = len(gdf)
    page = gdf.iloc[offset : offset + limit]
    return [_parcel_row_to_dict(row) for _, row in page.iterrows()], total


def _parcel_row_to_dict(row: Any) -> dict[str, Any]:
    from shapely.geometry import mapping

    geom = row.geometry
    geom_4326 = _reproject_geom_to_4326(geom)

    # area_acres may already be stored; recompute if not.
    if "area_acres" in row.index and row["area_acres"] > 0:
        area_acres = float(row["area_acres"])
    else:
        from app.core.geometry import compute_area_acres
        area_acres = compute_area_acres(geom)

    extra_attrs = {
        k: v
        for k, v in row.items()
        if k not in ("geometry", "area_acres") and not hasattr(v, "geom_type")
    }

    return {
        "id": str(row["parcel_id"]),
        "geometry": mapping(geom_4326),
        "area_acres": area_acres,
        "attributes": {k: (v if not hasattr(v, "item") else v.item()) for k, v in extra_attrs.items()},
    }


def _reproject_geom_to_4326(geom: Any) -> Any:
    import pyproj
    from shapely.ops import transform

    transformer = pyproj.Transformer.from_crs(WORKING_CRS, "EPSG:4326", always_xy=True)
    return transform(transformer.transform, geom)
