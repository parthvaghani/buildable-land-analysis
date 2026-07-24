#!/usr/bin/env python3
"""
Ingest FEMA 100-year floodplain zones for Hays County, TX from the
National Flood Hazard Layer (NFHL).

Source:  FEMA Flood Map Service Center — NFHL REST API
         https://msc.fema.gov
         https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28
Accessed: 2025-01-15  (update this line after re-downloading)

100-year floodplain zones (Flood Hazard Zones) included:
  A, AE, AH, AO, A99, AR, V, VE
  (all "Special Flood Hazard Areas" per FEMA terminology)

Zones X and X500 (0.2% annual chance) are NOT included.

Output:  data/processed/flood_zones.parquet
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import geopandas as gpd
import requests

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "data" / "raw" / "flood"
OUT_FILE = ROOT / "data" / "processed" / "flood_zones.parquet"

WORKING_CRS = "EPSG:32614"
COUNTY_FIPS = "48209"

# Hays County approximate bbox in WGS 84.
HAYS_BBOX_WGS84 = (-98.175, 29.850, -97.619, 30.512)

# FEMA NFHL Flood Hazard Zones layer (layer 28 = S_FLD_HAZ_AR).
FEMA_REST_URL = (
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"
)

# Only SFHA (Special Flood Hazard Area) zones — 100-year floodplain.
SFHA_ZONES = ("A", "AE", "AH", "AO", "A99", "AR", "AE", "V", "VE")

MAX_FEATURES_PER_PAGE = 1000

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


def fetch_fema_rest(bbox_wgs84: tuple[float, float, float, float]) -> gpd.GeoDataFrame | None:
    minx, miny, maxx, maxy = bbox_wgs84
    geometry_str = json.dumps({
        "xmin": minx, "ymin": miny, "xmax": maxx, "ymax": maxy,
        "spatialReference": {"wkid": 4326},
    })

    # WHERE clause filters to SFHA zones only.
    zone_list = ",".join(f"'{z}'" for z in SFHA_ZONES)
    where_clause = f"FLD_ZONE IN ({zone_list})"

    all_features: list[dict] = []
    offset = 0

    while True:
        params = {
            "geometry": geometry_str,
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "outSR": 4326,
            "where": where_clause,
            "outFields": "FLD_ZONE,ZONE_SUBTY,SFHA_TF",
            "returnGeometry": "true",
            "f": "geojson",
            "resultOffset": offset,
            "resultRecordCount": MAX_FEATURES_PER_PAGE,
        }
        try:
            resp = requests.get(FEMA_REST_URL, params=params, timeout=60)
            resp.raise_for_status()
        except Exception as exc:
            log.error("FEMA REST query failed (offset=%d): %s", offset, exc)
            return None

        data = resp.json()
        features = data.get("features", [])
        log.info("  Page offset=%d: %d features", offset, len(features))
        all_features.extend(features)

        if len(features) < MAX_FEATURES_PER_PAGE:
            break
        offset += MAX_FEATURES_PER_PAGE
        time.sleep(0.5)

    if not all_features:
        log.warning("No FEMA flood zone features returned.")
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    gdf = gpd.GeoDataFrame.from_features(all_features, crs="EPSG:4326")
    log.info("Total FEMA flood zone features: %d", len(gdf))
    return gdf


def run(local_only: bool = False) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw_geojson = RAW_DIR / "flood_zones_hays.geojson"

    if not local_only:
        gdf = fetch_fema_rest(HAYS_BBOX_WGS84)
        if gdf is None:
            log.error("Flood zone download failed.")
            sys.exit(1)
        gdf.to_file(raw_geojson, driver="GeoJSON")
        log.info("Saved raw flood zones to %s", raw_geojson)
    else:
        if not raw_geojson.exists():
            log.error("--local-only but %s not found", raw_geojson)
            sys.exit(1)
        gdf = gpd.read_file(raw_geojson)

    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    gdf = gdf.to_crs(WORKING_CRS)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].reset_index(drop=True)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_parquet(OUT_FILE)
    log.info("Wrote %d flood zone features to %s", len(gdf), OUT_FILE)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-only", action="store_true")
    args = parser.parse_args()
    run(local_only=args.local_only)
