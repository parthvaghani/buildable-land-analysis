#!/usr/bin/env python3
"""
Ingest USFWS National Wetlands Inventory (NWI) for Hays County, TX.

Source:  U.S. Fish & Wildlife Service — National Wetlands Inventory
         https://www.fws.gov/program/national-wetlands-inventory/wetlands-data
Dataset: Texas state geodatabase (county clip applied below)
Accessed: 2025-01-15  (update this line after re-downloading)

WFS endpoint used for county-level query (no large state download required):
  https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/
      Wetlands/MapServer/0/query

Only "palustrine" and "estuarine" wetland types are typically relevant to
buildable-land exclusions; lacustrine (open water) is also included.
Riverine (ATTRIBUTE like 'R%') can optionally be excluded depending on
local ordinances — left in here as a conservative default.

Output:  data/processed/wetlands.parquet
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sys
import time
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import box, shape

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "data" / "raw" / "wetlands"
OUT_FILE = ROOT / "data" / "processed" / "wetlands.parquet"

WORKING_CRS = "EPSG:32614"

# Hays County approximate bounding box in WGS 84.
HAYS_BBOX_WGS84 = (-98.175, 29.850, -97.619, 30.512)

# NWI MapServer REST endpoint (public, no auth required).
NWI_REST_URL = (
    "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/"
    "Wetlands/MapServer/0/query"
)

MAX_FEATURES_PER_PAGE = 1000

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


def fetch_nwi_rest(bbox_wgs84: tuple[float, float, float, float]) -> gpd.GeoDataFrame | None:
    """
    Paginate through the NWI REST service and return a GeoDataFrame
    clipped to the given WGS-84 bounding box.
    """
    minx, miny, maxx, maxy = bbox_wgs84
    geometry_str = json.dumps({
        "xmin": minx, "ymin": miny, "xmax": maxx, "ymax": maxy,
        "spatialReference": {"wkid": 4326},
    })

    all_features: list[dict] = []
    offset = 0

    while True:
        params = {
            # ArcGIS returns an empty feature set (not an error) when `where` is
            # omitted, and ignores the envelope without an explicit spatialRel.
            "where": "1=1",
            "geometry": geometry_str,
            "geometryType": "esriGeometryEnvelope",
            "spatialRel": "esriSpatialRelIntersects",
            "inSR": 4326,
            "outSR": 4326,
            # Layer 0 is a join of Wetlands to NWI_Wetland_Codes, so field names
            # are table-qualified.  Unqualified names make the service reject the
            # whole query with a generic 400 (returned as HTTP 200).
            "outFields": "Wetlands.ATTRIBUTE,Wetlands.WETLAND_TYPE,Wetlands.ACRES",
            "returnGeometry": "true",
            "f": "geojson",
            "resultOffset": offset,
            "resultRecordCount": MAX_FEATURES_PER_PAGE,
        }
        try:
            # The joined layer is slow to page over a county-sized envelope;
            # 60s was not enough for the first page.
            resp = requests.get(NWI_REST_URL, params=params, timeout=300)
            resp.raise_for_status()
        except Exception as exc:
            log.error("NWI REST query failed (offset=%d): %s", offset, exc)
            return None

        data = resp.json()
        # ArcGIS reports query errors in a 200 body, so raise_for_status() above
        # does not catch them.  Surface them instead of silently paging out.
        if "error" in data:
            log.error("NWI REST error (offset=%d): %s", offset, data["error"])
            return None
        features = data.get("features", [])
        log.info("  Page offset=%d: %d features", offset, len(features))
        all_features.extend(features)

        if len(features) < MAX_FEATURES_PER_PAGE:
            break
        offset += MAX_FEATURES_PER_PAGE
        time.sleep(0.5)  # be polite to the public service

    if not all_features:
        # Writing an empty layer here would look like "this county has no
        # wetlands" rather than "the download broke", so treat it as a failure.
        log.error("No NWI features returned for this bbox — refusing to write an empty layer.")
        return None

    geojson_fc = {"type": "FeatureCollection", "features": all_features}
    gdf = gpd.GeoDataFrame.from_features(geojson_fc["features"], crs="EPSG:4326")
    log.info("Total NWI features fetched: %d", len(gdf))
    return gdf


def run(local_only: bool = False) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw_geojson = RAW_DIR / "wetlands_hays.geojson"

    if not local_only:
        gdf = fetch_nwi_rest(HAYS_BBOX_WGS84)
        if gdf is None:
            log.error("Wetland download failed.")
            sys.exit(1)
        gdf.to_file(raw_geojson, driver="GeoJSON")
        log.info("Saved raw wetlands to %s", raw_geojson)
    else:
        if not raw_geojson.exists():
            log.error("--local-only but %s not found", raw_geojson)
            sys.exit(1)
        gdf = gpd.read_file(raw_geojson)

    # Reproject to working CRS and write GeoParquet.
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    gdf = gdf.to_crs(WORKING_CRS)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].reset_index(drop=True)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_parquet(OUT_FILE)
    log.info("Wrote %d wetland features to %s", len(gdf), OUT_FILE)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-only", action="store_true")
    args = parser.parse_args()
    run(local_only=args.local_only)
