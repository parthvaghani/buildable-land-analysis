"""
Shared fixtures for backend tests.

Uses synthetic geometries in EPSG:32614 (UTM Zone 14N) to avoid any
dependency on downloaded data files.  All coordinates are in metres.
"""

from __future__ import annotations

import pytest
from shapely.geometry import Polygon


@pytest.fixture
def square_parcel():
    """1000 m × 1000 m parcel = 1,000,000 m² ≈ 247.105 acres."""
    return Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])


@pytest.fixture
def small_wetland():
    """200 m × 200 m wetland in the SW corner of the parcel = 40,000 m²."""
    return Polygon([(0, 0), (200, 0), (200, 200), (0, 200)])


@pytest.fixture
def small_floodplain():
    """
    300 m × 300 m floodplain zone overlapping SW corner.
    Overlaps wetland fixture by 200 × 200 m = 40,000 m².
    """
    return Polygon([(0, 0), (300, 0), (300, 300), (0, 300)])
