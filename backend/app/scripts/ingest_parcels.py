#!/usr/bin/env python3
"""
Ingest parcel data for Hays County, TX from TNRIS.

Source:  Texas Natural Resources Information System (TNRIS) — StratMap Parcels
         https://data.tnris.org
County:  Hays County, TX  (FIPS 48209)
Accessed: 2025-01-15  (update this line after re-downloading)

Download path (TNRIS DataHub REST API):
  https://api.tnris.org/api/v1/catalog/search/?search=hays+county+parcels

If the automated download fails (TNRIS occasionally changes catalog IDs):
  1. Visit https://data.tnris.org and search "Hays County parcels".
  2. Download the shapefile/geodatabase manually.
  3. Place the extracted folder at data/raw/parcels/ and re-run this script
     with --local-only to skip the download step.

Output:  data/processed/parcels.parquet
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import requests

ROOT = Path(__file__).resolve().parents[3]  # repo root
RAW_DIR = ROOT / "data" / "raw" / "parcels"
OUT_FILE = ROOT / "data" / "processed" / "parcels.parquet"

WORKING_CRS = "EPSG:32614"
COUNTY_FIPS = "48209"
COUNTY_NAME = "Hays"

# TxGIO (formerly TNRIS) DataHub API.  The older /api/v1/catalog/search/ endpoint
# was retired and now returns 404; collections + resources are the current path.
# Collections are statewide "Land Parcels" releases; each has one zip per county,
# named stratmap<yy>-landparcels_<fips>_lp.zip.
TNRIS_COLLECTIONS_URL = "https://api.tnris.org/api/v1/collections/?search=parcels&limit=25"
TNRIS_RESOURCES_URL = "https://api.tnris.org/api/v1/resources/?collection_id={collection_id}"

# data.geographic.texas.gov returns 403 to non-browser user agents.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
}

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


def _find_county_resource() -> str | None:
    """
    Locate the newest TxGIO Land Parcels zip for COUNTY_FIPS.

    Returns the download URL, or None if the catalog could not be queried or no
    resource matched the county.
    """
    try:
        resp = requests.get(TNRIS_COLLECTIONS_URL, timeout=30)
        resp.raise_for_status()
        collections = resp.json().get("results", [])
    except Exception as exc:
        log.error("TxGIO collection query failed: %s", exc)
        return None

    # Newest acquisition_date first, so we prefer the most recent release.
    candidates = [c for c in collections if COUNTY_NAME in (c.get("counties") or "")]
    candidates.sort(key=lambda c: c.get("acquisition_date") or "", reverse=True)

    if not candidates:
        log.error("No parcel collection lists %s County.", COUNTY_NAME)
        return None

    for coll in candidates:
        coll_id = coll["collection_id"]
        log.info(
            "Checking collection %s (%s)", coll_id, coll.get("acquisition_date", "unknown date")
        )
        try:
            r = requests.get(TNRIS_RESOURCES_URL.format(collection_id=coll_id), timeout=60)
            r.raise_for_status()
            resources = r.json().get("results", [])
        except Exception as exc:
            log.warning("  resource listing failed: %s", exc)
            continue

        # Match on the FIPS code in the filename rather than area_type_name —
        # the filename is the authoritative identifier.
        for res in resources:
            url = res.get("resource", "")
            if f"_{COUNTY_FIPS}_" in url and url.endswith(".zip"):
                log.info(
                    "  found %s County parcels (%.1f MB)",
                    COUNTY_NAME,
                    res.get("filesize", 0) / 1e6,
                )
                return url

    log.error("No resource found for FIPS %s in any parcel collection.", COUNTY_FIPS)
    return None


def download_tnris(out_dir: Path) -> Path | None:
    """
    Query the TxGIO DataHub API and download the county parcel zip.
    Returns the path to the extracted directory, or None on failure.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    download_url = _find_county_resource()
    if not download_url:
        return None

    log.info("Downloading: %s", download_url)
    zip_path = out_dir / "parcels.zip"
    try:
        with requests.get(download_url, stream=True, timeout=300, headers=HEADERS) as r:
            r.raise_for_status()
            with open(zip_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
    except Exception as exc:
        log.error("Download failed: %s", exc)
        return None

    log.info("Extracting…")
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(out_dir)

    return out_dir


def find_vector_file(directory: Path) -> Path | None:
    """Find the first .shp, .gdb, or .gpkg in a directory tree."""
    for suffix in (".shp", ".gpkg", ".gdb"):
        matches = list(directory.rglob(f"*{suffix}"))
        if matches:
            return matches[0]
    return None


def run(local_only: bool = False) -> None:
    if not local_only and not RAW_DIR.exists():
        result = download_tnris(RAW_DIR)
        if result is None:
            log.error(
                "Download failed.  Manually place Hays County parcel data at %s "
                "and re-run with --local-only.",
                RAW_DIR,
            )
            sys.exit(1)

    vec_file = find_vector_file(RAW_DIR)
    if vec_file is None:
        log.error("No vector file (.shp/.gpkg/.gdb) found under %s", RAW_DIR)
        sys.exit(1)

    log.info("Reading parcel data from %s", vec_file)
    gdf = gpd.read_file(vec_file)
    log.info("  %d features, CRS: %s", len(gdf), gdf.crs)

    # Ensure a stable string parcel_id column.
    if "parcel_id" not in gdf.columns:
        for candidate in ("GEO_ID", "PROP_ID", "PARCEL_ID", "APN", "OBJECTID"):
            if candidate in gdf.columns:
                gdf = gdf.rename(columns={candidate: "parcel_id"})
                break
        else:
            gdf = gdf.copy()
            gdf["parcel_id"] = gdf.index.astype(str)
    gdf["parcel_id"] = gdf["parcel_id"].astype(str)

    # Reproject to working CRS.
    if gdf.crs is None:
        log.warning("Source has no CRS; assuming EPSG:4326.")
        gdf = gdf.set_crs("EPSG:4326")
    gdf = gdf.to_crs(WORKING_CRS)

    # Compute and store area in acres (in working CRS — accurate for UTM).
    SQ_M_PER_ACRE = 4_046.856_422_4
    gdf["area_acres"] = (gdf.geometry.area / SQ_M_PER_ACRE).round(2)

    # Drop empty/null geometries.
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].reset_index(drop=True)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_parquet(OUT_FILE)
    log.info("Wrote %d parcels to %s", len(gdf), OUT_FILE)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--local-only",
        action="store_true",
        help="Skip download; expect data already at data/raw/parcels/",
    )
    args = parser.parse_args()
    run(local_only=args.local_only)
