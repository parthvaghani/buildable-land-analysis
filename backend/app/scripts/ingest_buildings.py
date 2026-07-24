#!/usr/bin/env python3
"""
Ingest Microsoft Building Footprints for Hays County, TX.

Source:  Microsoft Bing Maps — US Building Footprints (open license)
         https://github.com/microsoft/USBuildingFootprints
         State-level GeoJSON.gz file, clipped to Hays County bbox.
Accessed: 2025-01-15  (update this line after re-downloading)

The dataset is released under the Open Data Commons Open Database License (ODbL).
See: https://github.com/microsoft/USBuildingFootprints/blob/master/LICENSE

If the blob URL below changes (Microsoft publishes periodic dataset updates),
visit the GitHub page above to find the current Texas download link.

Output:  data/processed/buildings.parquet
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
import shutil
import sys
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import box, shape

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "data" / "raw" / "buildings"
OUT_FILE = ROOT / "data" / "processed" / "buildings.parquet"

WORKING_CRS = "EPSG:32614"

# Hays County approximate bbox in WGS 84.
HAYS_BBOX_WGS84 = (-98.175, 29.850, -97.619, 30.512)

# Microsoft Building Footprints — Texas state file.
# Check https://github.com/microsoft/USBuildingFootprints for current URL.
MSFT_TX_URL = (
    "https://minedbuildings.blob.core.windows.net/global-buildings/"
    "2023-04-25/Texas.geojsonl.gz"
)

# Fallback: older release
MSFT_TX_URL_FALLBACK = (
    "https://usbuildingdata.blob.core.windows.net/usbuildings-v2/Texas.geojson.zip"
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


def download_file(url: str, dest: Path) -> bool:
    log.info("Downloading %s → %s", url, dest)
    try:
        with requests.get(url, stream=True, timeout=600) as r:
            r.raise_for_status()
            with open(dest, "wb") as f:
                shutil.copyfileobj(r.raw, f)
        return True
    except Exception as exc:
        log.error("Download failed: %s", exc)
        return False


def load_geojsonl_gz(path: Path, bbox: tuple[float, float, float, float]) -> gpd.GeoDataFrame:
    """
    Load a .geojsonl.gz (line-delimited GeoJSON gzip) and filter to bbox.
    Microsoft's file is one JSON feature per line — avoids loading 5 GB at once.
    """
    minx, miny, maxx, maxy = bbox
    bbox_geom = box(minx, miny, maxx, maxy)
    features = []

    log.info("Streaming %s (this may take several minutes for the full TX file)…", path)
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                feature = json.loads(line)
                geom = shape(feature.get("geometry", {}))
                if geom.intersects(bbox_geom):
                    features.append(feature)
            except Exception:
                continue

    log.info("Kept %d building footprints within Hays County bbox", len(features))
    if not features:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    return gdf


def run(local_only: bool = False) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw_gz = RAW_DIR / "Texas.geojsonl.gz"
    raw_geojson = RAW_DIR / "buildings_hays.geojson"

    if not local_only:
        if not raw_gz.exists():
            ok = download_file(MSFT_TX_URL, raw_gz)
            if not ok:
                log.info("Primary URL failed; trying fallback…")
                ok = download_file(MSFT_TX_URL_FALLBACK, raw_gz)
            if not ok:
                log.error(
                    "Building footprint download failed.  Visit "
                    "https://github.com/microsoft/USBuildingFootprints "
                    "for the current Texas download URL and place the file at %s.",
                    raw_gz,
                )
                sys.exit(1)

        gdf = load_geojsonl_gz(raw_gz, HAYS_BBOX_WGS84)
        gdf.to_file(raw_geojson, driver="GeoJSON")
        log.info("Saved %d buildings to %s", len(gdf), raw_geojson)
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
    log.info("Wrote %d building footprints to %s", len(gdf), OUT_FILE)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-only", action="store_true")
    args = parser.parse_args()
    run(local_only=args.local_only)
