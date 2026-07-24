# Buildable Land Analysis

Take-home assignment — Milestone 1 (FastAPI backend) + Milestone 2 (React/MapLibre frontend).

Given a parcel of land and a set of regulated constraint zones (wetlands, 100-year
floodplain, transmission-line easements, existing buildings), compute how much usable
area remains after subtracting each zone with a configurable setback buffer.

**Technical writeup:** [WRITEUP.md](WRITEUP.md) — approach, data sources, CRS rationale, UX decisions, known limitations.

---

## Quick start

### Prerequisites

- Python 3.11+
- `git`, `pip`

```bash
git clone <repo>
cd task

# Create and activate a virtualenv
python3.11 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

pip install -r backend/requirements.txt
```

### 1 — Ingest data (one-time setup)

Each script downloads public data, clips it to Hays County TX, reprojects to
EPSG:32614 (UTM Zone 14N), and writes a GeoParquet file to `data/processed/`.
Run them in any order:

```bash
cd backend

python -m app.scripts.ingest_parcels
python -m app.scripts.ingest_wetlands
python -m app.scripts.ingest_flood
python -m app.scripts.ingest_easements
python -m app.scripts.ingest_buildings
```

Each script accepts `--local-only` if the raw file is already at `data/raw/<layer>/`.

Expected output files after ingestion:

| File | Source |
|---|---|
| `data/processed/parcels.parquet` | TNRIS (Hays County CAD) |
| `data/processed/wetlands.parquet` | USFWS NWI |
| `data/processed/flood_zones.parquet` | FEMA NFHL |
| `data/processed/easements.parquet` | HIFLD Transmission Lines |
| `data/processed/buildings.parquet` | Microsoft Building Footprints |

> **Data sources & access dates** — see `WRITEUP.md` for exact URLs, setback rationale, and CRS methodology.

### 2 — Start the API server

```bash
# From repo root (with .venv active):
cd backend
uvicorn app.main:app --reload --port 8000
```

Interactive API docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### 3 — Start the frontend (Milestone 2)

```bash
cd frontend
npm install
npm run dev          # starts at http://localhost:5173
```

The frontend expects the backend at `http://localhost:8000`. To override:
```bash
VITE_API_BASE_URL=http://myhost:8000 npm run dev
```

### 4 — Run all tests

```bash
# Backend (30 tests, no data files needed):
cd backend && pytest

# Frontend (23 tests):
cd frontend && npm test -- --run
```

All tests use synthetic in-memory data — no ingestion required to run the suites.

---

## Configuration

Default setback distances live in `backend/app/config.yaml`.  To change them
**without editing code**, either:

1. Edit `config.yaml` and restart the server, **or**
2. Pass `buffers` in the `POST /compute` request body to override per-request.

```yaml
# backend/app/config.yaml (excerpt)
buffers:
  wetland_ft: 50
  floodplain_ft: 0
  easement_ft: 100
  building_ft: 10
```

---

## API reference

Full interactive docs at `/docs` after starting the server.

### `GET /health`
```
{ "status": "ok" }
```

### `GET /parcels`
Query params: `bbox` (minx,miny,maxx,maxy in EPSG:4326), `limit`, `offset`.
```json
{
  "parcels": [{ "id": "...", "geometry": {...}, "area_acres": 12.34, "attributes": {...} }],
  "total_count": 2847
}
```

### `GET /parcels/{id}`
Single parcel by ID.

### `GET /constraints`
```json
{ "layers": [{ "name": "wetland", "type": "wetland", "default_buffer_ft": 50, "source": "..." }] }
```

### `GET /config`
```json
{ "wetland_ft": 50, "floodplain_ft": 0, "easement_ft": 100, "building_ft": 10 }
```

### `POST /compute`
```json
{
  "parcel_id": "123456",
  "buffers": { "wetland_ft": 50, "floodplain_ft": 0, "easement_ft": 100, "building_ft": 10 },
  "carve_outs": [],
  "restores": []
}
```
Response:
```json
{
  "buildable_geojson": { "type": "Polygon", "coordinates": [[...]] },
  "excluded_geojson": { "type": "MultiPolygon", "coordinates": [[[...]]] },
  "buildable_acres": 38.72,
  "total_parcel_acres": 61.40,
  "breakdown": [
    { "type": "wetland",    "acres_removed": 8.14,  "source": "USFWS NWI" },
    { "type": "floodplain", "acres_removed": 12.31, "source": "FEMA NFHL" },
    { "type": "easement",   "acres_removed": 2.23,  "source": "HIFLD"     }
  ]
}
```

**Guarantee:** `sum(breakdown[].acres_removed) == total_parcel_acres - buildable_acres`

`excluded_geojson` is `parcel − buildable` (`null` when nothing was removed). It is
returned rather than derived client-side so the shaded area on the map comes from the
same geometry operation as the acreage and cannot drift from the breakdown.

---

## Example curl calls

```bash
# List first 5 parcels
curl "http://localhost:8000/parcels?limit=5"

# Get parcel by ID
curl "http://localhost:8000/parcels/123456"

# Get default buffer config
curl "http://localhost:8000/config"

# Compute buildable area with default buffers
curl -X POST http://localhost:8000/compute \
  -H "Content-Type: application/json" \
  -d '{
    "parcel_id": "123456",
    "buffers": { "wetland_ft": 50, "floodplain_ft": 0, "easement_ft": 100, "building_ft": 10 },
    "carve_outs": [],
    "restores": []
  }'

# Compute with custom wetland buffer and a user carve-out polygon (GeoJSON, EPSG:4326)
curl -X POST http://localhost:8000/compute \
  -H "Content-Type: application/json" \
  -d '{
    "parcel_id": "123456",
    "buffers": { "wetland_ft": 100, "floodplain_ft": 0, "easement_ft": 100, "building_ft": 10 },
    "carve_outs": [{
      "type": "Polygon",
      "coordinates": [[[-97.9, 30.1], [-97.89, 30.1], [-97.89, 30.11], [-97.9, 30.11], [-97.9, 30.1]]]
    }],
    "restores": []
  }'
```

---

## Docker

```bash
# Build
docker build -t buildable-api ./backend

# Run (mount the data directory so GeoParquet files are accessible)
docker run -p 8000:8000 -v "$(pwd)/data:/data" buildable-api
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Comma-separated allowed origins |

Copy `.env.example` → `.env` and fill in values.

There is no database. Parcels and constraint layers are read from GeoParquet into
memory at startup; nothing is persisted between runs.

---

## County selection

**Hays County, TX** (FIPS 48209) was chosen because:
- Manageable parcel count (~20,000–30,000 parcels via TNRIS CAD data — small enough for
  the in-memory default path, large enough to be representative).
- Located entirely within UTM Zone 14N (EPSG:32614) — no zone-boundary complexity.
- Active development pressure (Austin suburb) makes buildable-land analysis practically
  relevant.
- All five constraint layers have meaningful coverage in the county.
