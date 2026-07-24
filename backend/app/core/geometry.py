"""
Core geometry operations for buildable-land analysis.

All area computations are performed in the working projected CRS (EPSG:32614,
WGS 84 / UTM Zone 14N) which preserves distance and area for central Texas.
EPSG:3857 (Web Mercator) is never used here because its planar area formula
introduces latitude-dependent distortion that would make acreage figures
incorrect — an important correctness requirement for this analysis.
See BACKEND_NOTES.md for the full rationale.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import geopandas as gpd
import pyproj
from shapely import unary_union
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

# Conversion: 1 square metre → acres
_SQ_M_PER_ACRE = 4_046.856_422_4

# Conversion: feet → metres
_M_PER_FOOT = 0.3048

WORKING_CRS = "EPSG:32614"


# ---------------------------------------------------------------------------
# Unit helpers
# ---------------------------------------------------------------------------


def feet_to_meters(ft: float) -> float:
    return ft * _M_PER_FOOT


def sq_m_to_acres(sq_m: float) -> float:
    """Convert square metres to acres (full precision — round at the API boundary)."""
    return sq_m / _SQ_M_PER_ACRE


# ---------------------------------------------------------------------------
# CRS reprojection
# ---------------------------------------------------------------------------


def reproject_geom(geom: BaseGeometry, from_crs: str, to_crs: str) -> BaseGeometry:
    """Reproject a single Shapely geometry between CRS strings."""
    if from_crs == to_crs:
        return geom
    transformer = pyproj.Transformer.from_crs(from_crs, to_crs, always_xy=True)
    return transform(transformer.transform, geom)


def reproject_gdf(gdf: gpd.GeoDataFrame, target_crs: str) -> gpd.GeoDataFrame:
    """Return a copy of *gdf* reprojected to *target_crs*."""
    if gdf.crs is None:
        raise ValueError("GeoDataFrame has no CRS set; cannot reproject.")
    if str(gdf.crs) == target_crs:
        return gdf
    return gdf.to_crs(target_crs)


# ---------------------------------------------------------------------------
# Area calculation (always in projected CRS — see module docstring)
# ---------------------------------------------------------------------------


def compute_area_acres(geom: BaseGeometry, round_dp: int = 2) -> float:
    """
    Return the area of *geom* in acres.

    Caller is responsible for passing a geometry already in the working
    projected CRS (EPSG:32614).  Shapely reports area in that CRS's native
    units (square metres for UTM), which we convert to acres.

    Never call this on EPSG:3857 geometries — Web Mercator distorts area.

    round_dp controls output precision (default 2); pass 0 for full precision
    when accumulating intermediate values to avoid rounding-step errors.
    """
    if geom is None or geom.is_empty:
        return 0.0
    acres = sq_m_to_acres(geom.area)
    return round(acres, round_dp) if round_dp > 0 else acres


# ---------------------------------------------------------------------------
# Buffering
# ---------------------------------------------------------------------------


def buffer_geom(geom: BaseGeometry, distance_ft: float) -> BaseGeometry:
    """Buffer *geom* by *distance_ft* feet (geometry must be in EPSG:32614)."""
    if distance_ft <= 0:
        return geom
    return geom.buffer(feet_to_meters(distance_ft))


# ---------------------------------------------------------------------------
# Marginal breakdown — overlap-aware
# ---------------------------------------------------------------------------


@dataclass
class BreakdownRow:
    type: str
    acres_removed: float
    source: str


def compute_marginal_breakdown(
    parcel_geom: BaseGeometry,
    buffered_constraints: dict[str, BaseGeometry],
    sources: dict[str, str],
) -> list[BreakdownRow]:
    """
    Compute the overlap-aware marginal area removed by each constraint type.

    Processing is order-dependent: each type's contribution is the area it
    adds to the total excluded footprint *beyond* what all previously
    processed types already covered.  This ensures the sum of all
    breakdown rows equals the total area excluded by the union of all
    constraints — no area is double-counted when constraints overlap.

    Mathematical guarantee:
        sum(row.acres_removed for row in result)
        == compute_area_acres(union_of_all_constraints.intersection(parcel_geom))

    The caller verifies this invariant in the unit tests.
    """
    running_union: BaseGeometry | None = None
    rows: list[BreakdownRow] = []

    for layer_name, buffered_geom in buffered_constraints.items():
        clipped = buffered_geom.intersection(parcel_geom)

        if clipped.is_empty:
            marginal_area = 0.0
        elif running_union is None:
            marginal_area = clipped.area
        else:
            additional = clipped.difference(running_union)
            marginal_area = additional.area

        # Accumulate running union regardless of whether this layer added area.
        if running_union is None:
            running_union = clipped
        else:
            running_union = running_union.union(clipped)

        rows.append(
            BreakdownRow(
                type=layer_name,
                # Keep full precision here; caller rounds at API boundary.
                acres_removed=sq_m_to_acres(marginal_area),
                source=sources.get(layer_name, ""),
            )
        )

    return rows


# ---------------------------------------------------------------------------
# Main computation
# ---------------------------------------------------------------------------


@dataclass
class ComputeResult:
    buildable_geom: BaseGeometry
    buildable_acres: float
    total_parcel_acres: float
    breakdown: list[BreakdownRow]


def compute_buildable(
    parcel_geom: BaseGeometry,
    constraint_geometries: dict[str, BaseGeometry],
    buffer_distances_ft: dict[str, float],
    sources: dict[str, str],
    carve_outs: Sequence[BaseGeometry] = (),
    restores: Sequence[BaseGeometry] = (),
) -> ComputeResult:
    """
    Compute the buildable area for a single parcel.

    Algorithm:
    1. Buffer each constraint layer by its setback distance (in the working
       projected CRS, so distances are accurate metres-from-feet).
    2. Clip each buffered constraint to the parcel boundary — we only care
       about overlapping area.
    3. Union ALL constraint-clipped geometries into a single excluded footprint
       before subtracting.  This prevents double-subtraction when constraints
       overlap (e.g. a wetland inside a floodplain).
    4. buildable = parcel − constraint_union.
    5. Apply user carve-outs (additional exclusions drawn on the map).
    6. Apply user restores (additions drawn on the map), but hard constraints
       cannot be restored — restores are clipped to constraint-free areas first.
    7. Compute overlap-aware marginal breakdown so rows sum correctly.

    Args:
        parcel_geom: Parcel polygon in EPSG:32614.
        constraint_geometries: {layer_name: geometry} in EPSG:32614.
        buffer_distances_ft: {layer_name + "_ft": distance} — keys match
            "wetland_ft", "floodplain_ft", "easement_ft", "building_ft".
        sources: {layer_name: source_description} for breakdown output.
        carve_outs: User-drawn polygons to additionally exclude (EPSG:32614).
        restores: User-drawn polygons to add back (EPSG:32614); cannot
            reclaim areas covered by hard constraints.

    Returns:
        ComputeResult with buildable geometry, acreage, and breakdown.
    """
    # Step 1 & 2: buffer each layer and clip to parcel.
    buffered_clipped: dict[str, BaseGeometry] = {}
    for layer_name, layer_geom in constraint_geometries.items():
        if layer_geom is None or layer_geom.is_empty:
            continue
        buf_ft = buffer_distances_ft.get(f"{layer_name}_ft", 0.0)
        buffered = buffer_geom(layer_geom, buf_ft)
        clipped = buffered.intersection(parcel_geom)
        if not clipped.is_empty:
            buffered_clipped[layer_name] = clipped

    # Step 3: union of all constraint footprints (single subtract avoids double-counting).
    if buffered_clipped:
        hard_constraint_union = unary_union(list(buffered_clipped.values()))
    else:
        hard_constraint_union = None

    # Step 4: initial buildable geometry.
    if hard_constraint_union and not hard_constraint_union.is_empty:
        buildable = parcel_geom.difference(hard_constraint_union)
    else:
        buildable = parcel_geom

    # Step 5: apply user carve-outs.
    carve_out_union: BaseGeometry | None = None
    for co in carve_outs:
        co_clipped = co.intersection(parcel_geom)
        if not co_clipped.is_empty:
            buildable = buildable.difference(co_clipped)
            carve_out_union = co_clipped if carve_out_union is None else carve_out_union.union(co_clipped)

    # Step 6: apply restores — only within parcel and only in non-hard-constraint areas.
    restore_union: BaseGeometry | None = None
    for rs in restores:
        rs_clipped = rs.intersection(parcel_geom)
        if hard_constraint_union:
            rs_clipped = rs_clipped.difference(hard_constraint_union)
        if not rs_clipped.is_empty:
            buildable = buildable.union(rs_clipped)
            restore_union = rs_clipped if restore_union is None else restore_union.union(rs_clipped)

    # Ensure we never exceed the original parcel boundary.
    buildable = buildable.intersection(parcel_geom)

    # Round at the output boundary so breakdowns can be summed without rounding drift.
    # Compute areas at full float precision first; round at the very end.
    total_parcel_acres_raw = compute_area_acres(parcel_geom, round_dp=0)
    buildable_acres_raw = compute_area_acres(buildable, round_dp=0)

    # Step 7: overlap-aware marginal breakdown (full precision).
    breakdown = compute_marginal_breakdown(parcel_geom, buffered_clipped, sources)

    # Add user carve-out / restore row so the sum invariant holds.
    if carve_out_union is not None:
        co_beyond_constraints = carve_out_union
        if hard_constraint_union:
            co_beyond_constraints = co_beyond_constraints.difference(hard_constraint_union)
        co_area = co_beyond_constraints.area

        restored_from_co = (
            restore_union.intersection(co_beyond_constraints).area
            if restore_union is not None
            else 0.0
        )

        net_user_exclusion_m2 = co_area - restored_from_co
        if abs(net_user_exclusion_m2) > 1e-6:
            breakdown.append(
                BreakdownRow(
                    type="user_carve_out",
                    acres_removed=sq_m_to_acres(net_user_exclusion_m2),
                    source="user-drawn carve-out",
                )
            )

    # Round output values.  Round breakdown rows last so their sum matches the
    # rounded total exactly (achieved by rounding each to 2dp — the sum may
    # differ from total_removed by at most len(breakdown)*0.005 acres, which
    # is negligible; the API contract allows abs tolerance ≤ 0.05 ac).
    total_parcel_acres = round(total_parcel_acres_raw, 2)
    buildable_acres = round(buildable_acres_raw, 2)
    for row in breakdown:
        row.acres_removed = round(row.acres_removed, 2)

    return ComputeResult(
        buildable_geom=buildable,
        buildable_acres=buildable_acres,
        total_parcel_acres=total_parcel_acres,
        breakdown=breakdown,
    )
