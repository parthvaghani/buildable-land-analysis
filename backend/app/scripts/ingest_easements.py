#!/usr/bin/env python3
"""
Ingest electric power transmission lines for Hays County, TX from HIFLD.

Source:  Homeland Infrastructure Foundation-Level Data (HIFLD) Open Data
         Electric Power Transmission Lines
         https://hifld-geoplatform.opendata.arcgis.com/datasets/
             electric-power-transmission-lines
REST API: https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/
          Electric_Power_Transmission_Lines/FeatureServer/0/query
Accessed: 2025-01-15  (update this line after re-downloading)

NOTE ON EASEMENT WIDTH ASSUMPTION
The exact legal easement boundaries for transmission lines are not publicly
available — utilities hold them as private records.  This script downloads the
line centerlines only.  The 100 ft default buffer in config.yaml is applied at
compute time as a corridor proxy, representing a mid-range estimate for
high-voltage transmission (typical corridors run 100-200 ft depending on
voltage class).  This is documented as an assumption in BACKEND_NOTES.md.

Output:  data/processed/easements.parquet
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
RAW_DIR = ROOT / "data" / "raw" / "easements"
OUT_FILE = ROOT / "data" / "processed" / "easements.parquet"

WORKING_CRS = "EPSG:32614"

HAYS_BBOX_WGS84 = (-98.175, 29.850, -97.619, 30.512)

HIFLD_REST_URL = (
    "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/"
    "Electric_Power_Transmission_Lines/FeatureServer/0/query"
)

MAX_FEATURES_PER_PAGE = 1000

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


def fetch_hifld_rest(bbox_wgs84: tuple[float, float, float, float]) -> gpd.GeoDataFrame | None:
    minx, miny, maxx, maxy = bbox_wgs84
    geometry_str = json.dumps({
        "xmin": minx, "ymin": miny, "xmax": maxx, "ymax": maxy,
        "spatialReference": {"wkid": 4326},
    })

    all_features: list[dict] = []
    offset = 0

    while True:
        params = {
            "geometry": geometry_str,
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "outSR": 4326,
            "outFields": "VOLTAGE,TYPE,STATUS,OWNER",
            "returnGeometry": "true",
            "f": "geojson",
            "resultOffset": offset,
            "resultRecordCount": MAX_FEATURES_PER_PAGE,
        }
        try:
            resp = requests.get(HIFLD_REST_URL, params=params, timeout=60)
            resp.raise_for_status()
        except Exception as exc:
            log.error("HIFLD REST query failed (offset=%d): %s", offset, exc)
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
        log.warning("No transmission line features returned.")
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    gdf = gpd.GeoDataFrame.from_features(all_features, crs="EPSG:4326")
    log.info("Total transmission line features: %d", len(gdf))
    return gdf


def run(local_only: bool = False) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw_geojson = RAW_DIR / "easements_hays.geojson"

    if not local_only:
        gdf = fetch_hifld_rest(HAYS_BBOX_WGS84)
        if gdf is None:
            log.error("Transmission line download failed.")
            sys.exit(1)
        gdf.to_file(raw_geojson, driver="GeoJSON")
        log.info("Saved raw transmission lines to %s", raw_geojson)
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
    log.info("Wrote %d transmission line features to %s", len(gdf), OUT_FILE)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-only", action="store_true")
    args = parser.parse_args()
    run(local_only=args.local_only)
