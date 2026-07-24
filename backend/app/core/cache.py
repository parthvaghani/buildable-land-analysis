"""
In-process cache for constraint data and per-parcel precomputed intersections.

Design rationale
----------------
Static constraint layers (wetlands, floodplain, easements, buildings) are
loaded from GeoParquet once at startup and held in memory as GeoDataFrames.
A Shapely STRtree spatial index is built per layer for fast bbox pre-filtering
before exact intersection tests.

Per-parcel constraint geometries are cached in a plain dict keyed by parcel_id
so that repeated /compute calls for the same parcel skip the full spatial join.
Cache is invalidated on startup (it's in-process and ephemeral).

Performance envelope
--------------------
This approach handles a few thousand parcels and tens of thousands of constraint
features comfortably on a single machine because everything fits in RAM.  Beyond
that scale (or under concurrent load), the single-threaded Shapely ops become
the bottleneck; the scaling path would be a spatial database (ST_Buffer/ST_Union/
ST_Difference pushed into the query engine with GiST indexes).  That is a described
direction, not something this repo implements — see BACKEND_NOTES.md.
"""

from __future__ import annotations

from typing import Any

import geopandas as gpd

from app.core.geometry import WORKING_CRS, reproject_gdf


class ConstraintStore:
    """Holds loaded constraint GeoDataFrames with their spatial indexes."""

    def __init__(self) -> None:
        self._layers: dict[str, gpd.GeoDataFrame] = {}
        # Per-parcel cache: {parcel_id: {layer_name: clipped_union_geom}}
        self._parcel_cache: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # Layer management
    # ------------------------------------------------------------------

    def register(self, name: str, gdf: gpd.GeoDataFrame) -> None:
        """Store a constraint layer, reprojecting if necessary."""
        gdf = reproject_gdf(gdf, WORKING_CRS)
        # Ensure spatial index is built.
        _ = gdf.sindex
        self._layers[name] = gdf

    def layer_names(self) -> list[str]:
        return list(self._layers.keys())

    def get_layer(self, name: str) -> gpd.GeoDataFrame | None:
        return self._layers.get(name)

    # ------------------------------------------------------------------
    # Per-parcel constraint geometry (unioned, clipped to parcel bbox)
    # ------------------------------------------------------------------

    def get_parcel_constraints(
        self,
        parcel_id: str,
        parcel_geom: Any,
        buffer_distances_ft: dict[str, float],
    ) -> dict[str, Any]:
        """
        Return {layer_name: geometry} for constraints that intersect parcel_geom.

        Results are memoised per parcel_id.  Cache key does NOT include buffer
        distances because we return raw geometries and let the caller apply
        buffers — this way a change in buffer settings doesn't require re-running
        the spatial join.
        """
        if parcel_id in self._parcel_cache:
            return self._parcel_cache[parcel_id]

        from shapely import unary_union

        result: dict[str, Any] = {}
        parcel_bounds = parcel_geom.bounds  # (minx, miny, maxx, maxy)

        for name, gdf in self._layers.items():
            # Bbox pre-filter via STRtree (fast).
            candidate_idx = list(gdf.sindex.intersection(parcel_bounds))
            if not candidate_idx:
                continue
            candidates = gdf.iloc[candidate_idx]

            # Exact intersection test.
            hits = candidates[candidates.intersects(parcel_geom)]
            if hits.empty:
                continue

            combined = unary_union(hits.geometry.values)
            result[name] = combined

        self._parcel_cache[parcel_id] = result
        return result

    def invalidate(self, parcel_id: str | None = None) -> None:
        if parcel_id is None:
            self._parcel_cache.clear()
        else:
            self._parcel_cache.pop(parcel_id, None)


# Module-level singleton populated at startup by app/main.py.
constraint_store = ConstraintStore()
