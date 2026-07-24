"""
API integration tests for all five endpoints.

These tests start the FastAPI app with a synthetic in-memory parcel and
constraint layer — no GeoParquet files on disk are required.  This makes
the tests runnable immediately after `pip install -r requirements.txt`
without running ingestion scripts.
"""

from __future__ import annotations

import geopandas as gpd
import pytest
import pyproj
from httpx import AsyncClient, ASGITransport
from shapely.geometry import Polygon, mapping
from shapely.ops import transform

from app.main import app
from app.core import cache as cache_module
from app.core import loader as loader_module
from app.core.geometry import WORKING_CRS

# ---------------------------------------------------------------------------
# Synthetic data setup — injected before any test uses the app
# ---------------------------------------------------------------------------

PARCEL_ID = "test-parcel-001"

# 1000 × 1000 m square in UTM 14N (roughly central Texas).
_PARCEL_GEOM_WORKING = Polygon([(600000, 3300000), (601000, 3300000),
                                 (601000, 3301000), (600000, 3301000)])

_WETLAND_GEOM_WORKING = Polygon([(600000, 3300000), (600200, 3300000),
                                   (600200, 3300200), (600000, 3300200)])


def _to_4326(geom):
    transformer = pyproj.Transformer.from_crs(WORKING_CRS, "EPSG:4326", always_xy=True)
    return transform(transformer.transform, geom)


@pytest.fixture(autouse=True)
def inject_synthetic_data():
    """
    Monkey-patch the loader and constraint store so all API tests run against
    a predictable synthetic dataset, not GeoParquet files that may not exist.
    """
    parcel_4326 = _to_4326(_PARCEL_GEOM_WORKING)

    parcels_gdf = gpd.GeoDataFrame(
        {
            "parcel_id": [PARCEL_ID],
            "area_acres": [round(_PARCEL_GEOM_WORKING.area / 4_046.856422, 2)],
            "COUNTY": ["Hays"],
        },
        geometry=[_PARCEL_GEOM_WORKING],
        crs=WORKING_CRS,
    )
    _ = parcels_gdf.sindex

    wetland_gdf = gpd.GeoDataFrame(
        {"WETLAND_TYPE": ["Palustrine Emergent"]},
        geometry=[_WETLAND_GEOM_WORKING],
        crs=WORKING_CRS,
    )

    original_parcels = loader_module._parcels_gdf
    original_layers = dict(cache_module.constraint_store._layers)
    original_cache = dict(cache_module.constraint_store._parcel_cache)

    loader_module._parcels_gdf = parcels_gdf
    cache_module.constraint_store._layers = {"wetland": wetland_gdf}
    cache_module.constraint_store._parcel_cache = {}
    _ = wetland_gdf.sindex

    yield

    loader_module._parcels_gdf = original_parcels
    cache_module.constraint_store._layers = original_layers
    cache_module.constraint_store._parcel_cache = original_cache


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# GET /parcels
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_parcels(client):
    resp = await client.get("/parcels")
    assert resp.status_code == 200
    body = resp.json()
    assert "parcels" in body
    assert "total_count" in body
    assert body["total_count"] >= 1
    p = body["parcels"][0]
    assert "id" in p
    assert "geometry" in p
    assert "area_acres" in p
    assert "attributes" in p


@pytest.mark.asyncio
async def test_list_parcels_limit(client):
    resp = await client.get("/parcels?limit=1&offset=0")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["parcels"]) <= 1


@pytest.mark.asyncio
async def test_list_parcels_bad_bbox(client):
    resp = await client.get("/parcels?bbox=notvalid")
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /parcels/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_parcel_found(client):
    resp = await client.get(f"/parcels/{PARCEL_ID}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == PARCEL_ID
    assert body["geometry"]["type"] in ("Polygon", "MultiPolygon")
    assert body["area_acres"] > 0


@pytest.mark.asyncio
async def test_get_parcel_not_found(client):
    resp = await client.get("/parcels/does-not-exist-99999")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /constraints
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_constraints(client):
    resp = await client.get("/constraints")
    assert resp.status_code == 200
    body = resp.json()
    assert "layers" in body
    layers = body["layers"]
    assert len(layers) > 0
    for layer in layers:
        assert "name" in layer
        assert "type" in layer
        assert "default_buffer_ft" in layer
        assert "source" in layer


# ---------------------------------------------------------------------------
# GET /config
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_config(client):
    resp = await client.get("/config")
    assert resp.status_code == 200
    body = resp.json()
    assert "wetland_ft" in body
    assert "floodplain_ft" in body
    assert "easement_ft" in body
    assert "building_ft" in body
    assert body["wetland_ft"] == 50.0
    assert body["floodplain_ft"] == 0.0
    assert body["easement_ft"] == 100.0
    assert body["building_ft"] == 10.0


# ---------------------------------------------------------------------------
# POST /compute
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_compute_basic(client):
    payload = {
        "parcel_id": PARCEL_ID,
        "buffers": {"wetland_ft": 0, "floodplain_ft": 0, "easement_ft": 0, "building_ft": 0},
        "carve_outs": [],
        "restores": [],
    }
    resp = await client.post("/compute", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert "buildable_geojson" in body
    assert "buildable_acres" in body
    assert "total_parcel_acres" in body
    assert "breakdown" in body
    assert body["buildable_acres"] > 0
    assert body["total_parcel_acres"] > body["buildable_acres"]


@pytest.mark.asyncio
async def test_compute_sum_invariant(client):
    """sum(breakdown.acres_removed) must equal total_parcel_acres - buildable_acres."""
    payload = {
        "parcel_id": PARCEL_ID,
        "buffers": {"wetland_ft": 50, "floodplain_ft": 0, "easement_ft": 0, "building_ft": 0},
        "carve_outs": [],
        "restores": [],
    }
    resp = await client.post("/compute", json=payload)
    assert resp.status_code == 200
    body = resp.json()

    expected_removed = round(body["total_parcel_acres"] - body["buildable_acres"], 2)
    actual_sum = round(sum(row["acres_removed"] for row in body["breakdown"]), 2)
    assert abs(actual_sum - expected_removed) < 0.05, (
        f"Breakdown sum {actual_sum} ac ≠ removed {expected_removed} ac"
    )


@pytest.mark.asyncio
async def test_compute_breakdown_fields(client):
    """Each breakdown row has required fields."""
    payload = {
        "parcel_id": PARCEL_ID,
        "buffers": {"wetland_ft": 50, "floodplain_ft": 0, "easement_ft": 0, "building_ft": 0},
        "carve_outs": [],
        "restores": [],
    }
    resp = await client.post("/compute", json=payload)
    assert resp.status_code == 200
    for row in resp.json()["breakdown"]:
        assert "type" in row
        assert "acres_removed" in row
        assert "source" in row


@pytest.mark.asyncio
async def test_compute_parcel_not_found(client):
    payload = {"parcel_id": "nonexistent-9999", "buffers": {}, "carve_outs": [], "restores": []}
    resp = await client.post("/compute", json=payload)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_compute_with_carve_out(client):
    """Carve-out reduces buildable area further."""
    parcel_4326 = _to_4326(_PARCEL_GEOM_WORKING)
    bounds = parcel_4326.bounds  # (minx, miny, maxx, maxy) in lon/lat

    # Carve out a 100×100 m region (translated to lon/lat roughly).
    # Use a tiny Polygon inside the parcel in 4326 approx.
    transformer = pyproj.Transformer.from_crs(WORKING_CRS, "EPSG:4326", always_xy=True)
    # Place carve-out in the NE corner — well away from the SW-corner wetland fixture.
    pts = [(600700, 3300700), (600900, 3300700), (600900, 3300900), (600700, 3300900)]
    co_pts_4326 = [transformer.transform(x, y) for x, y in pts]
    co_geojson = {
        "type": "Polygon",
        "coordinates": [[list(p) for p in co_pts_4326] + [list(co_pts_4326[0])]],
    }

    base = await client.post("/compute", json={
        "parcel_id": PARCEL_ID,
        "buffers": {"wetland_ft": 0, "floodplain_ft": 0, "easement_ft": 0, "building_ft": 0},
        "carve_outs": [],
        "restores": [],
    })
    with_co = await client.post("/compute", json={
        "parcel_id": PARCEL_ID,
        "buffers": {"wetland_ft": 0, "floodplain_ft": 0, "easement_ft": 0, "building_ft": 0},
        "carve_outs": [co_geojson],
        "restores": [],
    })

    assert with_co.status_code == 200
    assert with_co.json()["buildable_acres"] < base.json()["buildable_acres"]
