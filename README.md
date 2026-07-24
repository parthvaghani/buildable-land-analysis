# Buildable Land Analysis

Given a parcel and a set of regulated constraint zones — wetlands, 100-year floodplain,
transmission-line easements, existing buildings — work out how much of it is actually
buildable once each zone is subtracted with its setback, show the result on a map, and let
someone adjust it by hand.

A parcel might be 100 acres on paper and 60 once the constraints come out.

FastAPI backend, React + MapLibre frontend, Hays County TX.

- [SETUP.md](SETUP.md) — installing and running on a fresh machine
- [WRITEUP.md](WRITEUP.md) — approach, data sources, setback rationale, limitations

## Quick start

Assumes Python 3.11+ and Node 20+. Full instructions in [SETUP.md](SETUP.md).

```bash
python -m venv venv
source venv/bin/activate          # Windows: .\venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt

cd frontend && npm install && cd ..
```

Ingest the data once. Each script downloads a public dataset, clips it to Hays County,
reprojects to EPSG:32614, and writes GeoParquet to `data/processed/`:

```bash
cd backend
python -m app.scripts.ingest_parcels      # ~117k parcels, 67 MB download
python -m app.scripts.ingest_wetlands     # ~13k features, takes ~10 min
python -m app.scripts.ingest_easements
python -m app.scripts.ingest_flood        # currently fails, see below
python -m app.scripts.ingest_buildings    # currently fails, see below
```

Floodplain and buildings cannot be ingested at the moment — FEMA's server fails its TLS
handshake and Microsoft's blob storage returns 409. The app runs fine without them and
disables those map layers.

Then run the two servers:

```bash
cd backend && uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

Frontend at http://localhost:5173, API docs at http://localhost:8000/docs.

Tests need no data — both suites use synthetic fixtures:

```bash
cd backend && pytest              # 30 tests
cd frontend && npm test -- --run  # 23 tests
```

## Configuration

Setback distances live in `backend/app/config.yaml`. Edit and restart, or override
per-request by passing `buffers` to `POST /compute`. The sidebar sliders use the second.

```yaml
buffers:
  wetland_ft: 50
  floodplain_ft: 0
  easement_ft: 100
  building_ft: 10
```

`CORS_ORIGINS` is the only environment variable, defaulting to the two dev-server ports.
Copy `.env.example` to `.env` if you need to change it. There is no database.

## API

Interactive docs at `/docs`.

`GET /health` → `{"status": "ok"}`

`GET /parcels` — params: `bbox` (minx,miny,maxx,maxy in EPSG:4326), `q` (substring match
on ID, owner, address, legal description), `limit` (max 1000), `offset`.

```json
{
  "parcels": [{ "id": "...", "geometry": {}, "area_acres": 12.34, "attributes": {} }],
  "total_count": 117427
}
```

`GET /parcels/{id}` — one parcel.

`GET /constraints` — layer metadata plus `feature_count`, which is 0 for layers that
failed to ingest.

`GET /config` — the default buffer values.

`GET /constraint-features?parcel_id=X` — raw, un-buffered constraint geometry clipped to
one parcel, for the map overlays.

`POST /compute`

```json
{
  "parcel_id": "10-0147-0003-00000-3",
  "buffers": { "wetland_ft": 50, "floodplain_ft": 0, "easement_ft": 100, "building_ft": 10 },
  "carve_outs": [],
  "restores": []
}
```

```json
{
  "buildable_geojson": {},
  "excluded_geojson": {},
  "buildable_acres": 3143.00,
  "total_parcel_acres": 3410.60,
  "breakdown": [
    { "type": "wetland",  "acres_removed": 202.19, "source": "USFWS NWI" },
    { "type": "easement", "acres_removed": 65.42,  "source": "HIFLD" }
  ]
}
```

`buffers`, `carve_outs`, and `restores` are all optional. Carve-outs and restores are
GeoJSON polygons in EPSG:4326.

Two guarantees worth knowing:

- `sum(breakdown[].acres_removed) == total_parcel_acres - buildable_acres`
- `excluded_geojson` is `parcel − buildable`, computed by the same operation that produced
  the acreage, so the shaded area on the map cannot disagree with the number. It is `null`
  when nothing was removed.

Restores cannot reclaim regulated land. A restore is clipped against the hard-constraint
union before being added back, so it can only recover area you carved out yourself.

## Docker

```bash
docker build -t buildable-api ./backend
docker run -p 8000:8000 -v "$(pwd)/data:/data" buildable-api
```

Mount `data/` — the GeoParquet files are not baked into the image.

## Why Hays County

Entirely inside UTM Zone 14N, so there is no projection boundary to handle. Real
development pressure as an Austin suburb, and meaningful coverage in every constraint
layer. 117,427 parcels is large enough to be representative and small enough to hold in
memory.
