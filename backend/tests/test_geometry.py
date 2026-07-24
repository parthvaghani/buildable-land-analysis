"""
Unit tests for core/geometry.py.

All tests use synthetic polygons in EPSG:32614 (metre units) so results
are deterministic and require no downloaded data files.

The key correctness invariant tested here:
    sum(breakdown.acres_removed) == total_parcel_acres - buildable_acres

This must hold even when constraints overlap, because we union all constraint
buffers before subtracting (see compute_buildable docstring).
"""

from __future__ import annotations

import math

import pytest
from shapely.geometry import Polygon

from app.core.geometry import (
    BreakdownRow,
    ComputeResult,
    _SQ_M_PER_ACRE,
    buffer_geom,
    compute_area_acres,
    compute_buildable,
    compute_marginal_breakdown,
    feet_to_meters,
    sq_m_to_acres,
)


# ---------------------------------------------------------------------------
# Unit helpers
# ---------------------------------------------------------------------------


def test_feet_to_meters():
    assert abs(feet_to_meters(100) - 30.48) < 0.001


def test_sq_m_to_acres():
    # 1 acre = 4046.856... m²
    assert sq_m_to_acres(4_046.856_422_4) == pytest.approx(1.0, abs=0.001)


def test_compute_area_acres_square():
    # 1000 × 1000 m = 1,000,000 m²; compute_area_acres rounds to 2 dp by default
    parcel = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    expected_raw = 1_000_000 / _SQ_M_PER_ACRE
    # Default (round_dp=2) should be within 0.005 of true value.
    assert compute_area_acres(parcel) == pytest.approx(expected_raw, abs=0.005)
    # Full-precision variant should match exactly.
    assert compute_area_acres(parcel, round_dp=0) == pytest.approx(expected_raw, rel=1e-9)


def test_compute_area_acres_empty():
    from shapely.geometry import Point
    assert compute_area_acres(Point(0, 0)) == 0.0


def test_buffer_geom_zero():
    parcel = Polygon([(0, 0), (100, 0), (100, 100), (0, 100)])
    buffered = buffer_geom(parcel, 0)
    assert buffered.equals(parcel)


def test_buffer_geom_positive():
    line_like = Polygon([(0, 0), (100, 0), (100, 1), (0, 1)])
    buffered = buffer_geom(line_like, 100)  # 100 ft ≈ 30.48 m
    assert buffered.area > line_like.area


# ---------------------------------------------------------------------------
# Marginal breakdown — core invariant tests
# ---------------------------------------------------------------------------


def test_marginal_breakdown_no_overlap():
    """Two non-overlapping constraints: marginals sum to total excluded area."""
    parcel = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    # wetland: NW quadrant
    wetland = Polygon([(0, 500), (500, 500), (500, 1000), (0, 1000)])
    # floodplain: SE quadrant (no overlap with wetland)
    floodplain = Polygon([(500, 0), (1000, 0), (1000, 500), (500, 500)])

    constraints = {"wetland": wetland, "floodplain": floodplain}
    sources = {"wetland": "NWI", "floodplain": "FEMA"}

    rows = compute_marginal_breakdown(parcel, constraints, sources)

    total_excluded_acres = sq_m_to_acres(wetland.union(floodplain).intersection(parcel).area)
    sum_marginals = sum(r.acres_removed for r in rows)

    # Allow abs=0.02 to account for independent per-row rounding at 2 dp.
    assert sum_marginals == pytest.approx(total_excluded_acres, abs=0.02)
    # Each quadrant = 250,000 m²
    assert rows[0].acres_removed == pytest.approx(sq_m_to_acres(250_000), abs=0.01)
    assert rows[1].acres_removed == pytest.approx(sq_m_to_acres(250_000), abs=0.01)


def test_marginal_breakdown_full_overlap():
    """Two fully overlapping constraints: second contributes zero marginal area."""
    parcel = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    constraint_a = Polygon([(0, 0), (500, 0), (500, 500), (0, 500)])
    constraint_b = constraint_a  # exact same polygon

    constraints = {"a": constraint_a, "b": constraint_b}
    sources = {"a": "src_a", "b": "src_b"}

    rows = compute_marginal_breakdown(parcel, constraints, sources)

    total_excluded_acres = sq_m_to_acres(constraint_a.intersection(parcel).area)
    sum_marginals = sum(r.acres_removed for r in rows)

    assert sum_marginals == pytest.approx(total_excluded_acres, abs=0.01)
    assert rows[1].acres_removed == pytest.approx(0.0, abs=0.001)


def test_marginal_breakdown_partial_overlap():
    """
    Partial overlap between wetland and floodplain.

    Parcel: 1000×1000 m
    Wetland: SW 200×200 m = 40,000 m²
    Floodplain: SW 300×300 m = 90,000 m², overlaps wetland by 40,000 m²

    Processing order: wetland first, then floodplain.
    Expected marginals:
      wetland:    40,000 m²
      floodplain: 90,000 - 40,000 = 50,000 m²
    Sum: 90,000 m² == area(union)
    """
    parcel = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    wetland = Polygon([(0, 0), (200, 0), (200, 200), (0, 200)])
    floodplain = Polygon([(0, 0), (300, 0), (300, 300), (0, 300)])

    constraints = {"wetland": wetland, "floodplain": floodplain}
    sources = {"wetland": "NWI", "floodplain": "FEMA"}

    rows = compute_marginal_breakdown(parcel, constraints, sources)

    union_area_acres = sq_m_to_acres(wetland.union(floodplain).intersection(parcel).area)
    sum_marginals_acres = sum(r.acres_removed for r in rows)

    # abs=0.02 tolerates independent per-row 2-dp rounding.
    assert sum_marginals_acres == pytest.approx(union_area_acres, abs=0.02)
    assert rows[0].acres_removed == pytest.approx(sq_m_to_acres(40_000), abs=0.01)
    assert rows[1].acres_removed == pytest.approx(sq_m_to_acres(50_000), abs=0.01)


# ---------------------------------------------------------------------------
# compute_buildable — full pipeline tests
# ---------------------------------------------------------------------------


def test_compute_buildable_no_constraints():
    """No constraints → buildable == parcel."""
    parcel = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    result = compute_buildable(
        parcel_geom=parcel,
        constraint_geometries={},
        buffer_distances_ft={},
        sources={},
    )
    assert result.buildable_acres == pytest.approx(result.total_parcel_acres, abs=0.01)
    assert result.breakdown == []


def test_compute_buildable_full_exclusion():
    """Constraint covers entire parcel → buildable == 0."""
    parcel = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    # Constraint slightly larger than parcel (buffer at 0 ft still covers fully)
    big_wetland = Polygon([(-1, -1), (1001, -1), (1001, 1001), (-1, 1001)])
    result = compute_buildable(
        parcel_geom=parcel,
        constraint_geometries={"wetland": big_wetland},
        buffer_distances_ft={"wetland_ft": 0},
        sources={"wetland": "NWI"},
    )
    assert result.buildable_acres == pytest.approx(0.0, abs=0.01)
    assert result.breakdown[0].acres_removed == pytest.approx(result.total_parcel_acres, abs=0.01)


def test_compute_buildable_overlap_sum_invariant():
    """
    KEY INVARIANT: sum(breakdown.acres_removed) == total_parcel_acres - buildable_acres
    for overlapping constraints, with no buffers applied (distances 0 ft).
    """
    parcel = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    wetland = Polygon([(0, 0), (200, 0), (200, 200), (0, 200)])
    floodplain = Polygon([(0, 0), (300, 0), (300, 300), (0, 300)])

    result = compute_buildable(
        parcel_geom=parcel,
        constraint_geometries={"wetland": wetland, "floodplain": floodplain},
        buffer_distances_ft={"wetland_ft": 0, "floodplain_ft": 0},
        sources={"wetland": "NWI", "floodplain": "FEMA"},
    )

    expected_removed = result.total_parcel_acres - result.buildable_acres
    actual_sum = sum(row.acres_removed for row in result.breakdown)

    assert actual_sum == pytest.approx(expected_removed, abs=0.01), (
        f"Breakdown sum {actual_sum:.4f} ac ≠ removed {expected_removed:.4f} ac"
    )


def test_compute_buildable_with_buffer():
    """Buffer expands constraint exclusion zone."""
    parcel = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    # Point-like 10×10 feature in the centre; 50 ft ≈ 15.24 m buffer should expand it.
    tiny_wetland = Polygon([(495, 495), (505, 495), (505, 505), (495, 505)])

    result_no_buf = compute_buildable(
        parcel_geom=parcel,
        constraint_geometries={"wetland": tiny_wetland},
        buffer_distances_ft={"wetland_ft": 0},
        sources={"wetland": "NWI"},
    )
    result_with_buf = compute_buildable(
        parcel_geom=parcel,
        constraint_geometries={"wetland": tiny_wetland},
        buffer_distances_ft={"wetland_ft": 50},
        sources={"wetland": "NWI"},
    )
    assert result_with_buf.buildable_acres < result_no_buf.buildable_acres


def test_compute_buildable_carve_out():
    """User carve-out reduces buildable area beyond constraints."""
    parcel = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    # NE 200×200 carve-out in a clean area (no hard constraints here).
    carve_out = Polygon([(800, 800), (1000, 800), (1000, 1000), (800, 1000)])

    result = compute_buildable(
        parcel_geom=parcel,
        constraint_geometries={},
        buffer_distances_ft={},
        sources={},
        carve_outs=[carve_out],
    )

    # Should have one user_carve_out breakdown row.
    user_rows = [r for r in result.breakdown if r.type == "user_carve_out"]
    assert len(user_rows) == 1
    assert user_rows[0].acres_removed == pytest.approx(sq_m_to_acres(40_000), abs=0.01)

    expected_removed = result.total_parcel_acres - result.buildable_acres
    actual_sum = sum(row.acres_removed for row in result.breakdown)
    assert actual_sum == pytest.approx(expected_removed, abs=0.02)


def test_compute_buildable_restore():
    """Restore re-opens a carve-out area."""
    parcel = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    carve_out = Polygon([(800, 800), (1000, 800), (1000, 1000), (800, 1000)])

    result_co = compute_buildable(
        parcel_geom=parcel,
        constraint_geometries={},
        buffer_distances_ft={},
        sources={},
        carve_outs=[carve_out],
    )
    result_co_restored = compute_buildable(
        parcel_geom=parcel,
        constraint_geometries={},
        buffer_distances_ft={},
        sources={},
        carve_outs=[carve_out],
        restores=[carve_out],
    )
    # Restoring the exact carve-out should return to the full parcel area.
    assert result_co_restored.buildable_acres == pytest.approx(
        result_co_restored.total_parcel_acres, abs=0.01
    )


def test_compute_buildable_restore_cannot_reclaim_constraint():
    """Restores must not reclaim hard-constraint areas."""
    parcel = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    wetland = Polygon([(0, 0), (500, 0), (500, 500), (0, 500)])
    # Restore overlaps the wetland entirely.
    restore = Polygon([(0, 0), (500, 0), (500, 500), (0, 500)])

    result_with_constraint = compute_buildable(
        parcel_geom=parcel,
        constraint_geometries={"wetland": wetland},
        buffer_distances_ft={"wetland_ft": 0},
        sources={"wetland": "NWI"},
    )
    result_with_restore = compute_buildable(
        parcel_geom=parcel,
        constraint_geometries={"wetland": wetland},
        buffer_distances_ft={"wetland_ft": 0},
        sources={"wetland": "NWI"},
        restores=[restore],
    )
    # Restore over a hard constraint should have no effect.
    assert result_with_restore.buildable_acres == pytest.approx(
        result_with_constraint.buildable_acres, abs=0.01
    )


def test_compute_buildable_sum_invariant_with_carve_out_and_restore():
    """Sum invariant holds with overlapping constraints + carve-out + partial restore."""
    parcel = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    wetland = Polygon([(0, 0), (200, 0), (200, 200), (0, 200)])
    floodplain = Polygon([(0, 0), (300, 0), (300, 300), (0, 300)])
    carve_out = Polygon([(700, 700), (900, 700), (900, 900), (700, 900)])
    restore = Polygon([(750, 750), (850, 750), (850, 850), (750, 850)])  # inside carve-out

    result = compute_buildable(
        parcel_geom=parcel,
        constraint_geometries={"wetland": wetland, "floodplain": floodplain},
        buffer_distances_ft={"wetland_ft": 0, "floodplain_ft": 0},
        sources={"wetland": "NWI", "floodplain": "FEMA"},
        carve_outs=[carve_out],
        restores=[restore],
    )

    expected_removed = result.total_parcel_acres - result.buildable_acres
    actual_sum = sum(row.acres_removed for row in result.breakdown)
    assert actual_sum == pytest.approx(expected_removed, abs=0.02)
