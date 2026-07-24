# Setup

Getting this running on a machine with nothing installed. Around 20 minutes, most of it
waiting on data downloads.

You need Python 3.11+, Node 20+, and git. Verified on Python 3.13 and Node 20.

You do **not** need to install GDAL. `pyogrio` bundles its own, and every geospatial
dependency ships prebuilt wheels.

## Backend

Create the virtualenv on the machine you will run it on. Virtualenvs are not portable
across operating systems — one made under WSL has `bin/` and will not work from Windows,
which expects `Scripts/`.

```powershell
# Windows
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

```bash
# macOS / Linux
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
```

If PowerShell refuses to activate it:
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

## Frontend

```bash
cd frontend
npm install
```

`npm install` warns that one transitive package wants Node 22. It is only a warning and
everything works on Node 20.

## Environment files

Both optional — every value has a working default.

```bash
cp .env.example .env                      # backend, only to change CORS origins
cp frontend/.env.example frontend/.env.local   # only to point at a different backend URL
```

`frontend/.env.local` is gitignored. The one key that matters is `VITE_API_BASE_URL`.

## Data

The repo ships no data. `data/processed/` is gitignored because the GeoParquet files are
~80 MB and reproducible. The app starts without them but every parcel list will be empty.

Run from `backend/` with the virtualenv active:

```bash
python -m app.scripts.ingest_parcels      # ~2 min, 67 MB download, ~117k parcels
python -m app.scripts.ingest_wetlands     # ~10 min, paginated, ~13k features
python -m app.scripts.ingest_easements    # ~10 sec, 180 features
python -m app.scripts.ingest_flood
python -m app.scripts.ingest_buildings
```

The last two fail, and it is not something this repo can fix. FEMA's `hazards.fema.gov`
refuses or resets the connection; Microsoft's Azure blob returns `409 Public access is not
permitted`. Both scripts error out rather than writing an empty layer, and the app
disables those map toggles with a "no data" label.

A failed run leaves an empty folder under `data/raw/`, and the scripts skip downloading
when that folder exists — so delete it before retrying. If you fetch a file by hand
instead, put it in `data/raw/<layer>/` and pass `--local-only`.

### Skipping ingestion with the pre-built bundle

To skip the download/ingest step entirely, grab the pre-built data instead of running the
scripts above:

1. Download `data-bundle.zip` from
   [Releases → data-v1](https://github.com/parthvaghani/buildable-land-analysis/releases/tag/data-v1).
2. Extract it into the repo root:

   ```bash
   unzip data-bundle.zip -d .
   ```

   This creates `data/raw/` and `data/processed/` directly (the archive already contains
   that path prefix). Confirm afterwards that `data/processed/parcels.parquet` exists.

3. Start the backend as normal — no ingest scripts needed.

## Running

Two terminals:

```bash
cd backend && uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

On macOS/Linux, a `Makefile` at the repo root shortcuts this: `make backend`, `make
frontend`, or `make dev` to run both in one terminal (Ctrl+C stops both). Not available on
Windows — use the two commands above instead.

Startup takes about 10 seconds while the GeoParquet loads and spatial indexes build. Watch
for this, and check the parcel count is not zero:

```
INFO app.core.loader: Startup load complete — 117427 parcels in memory.
INFO:     Application startup complete.
```

`Constraint layer 'floodplain' not found` warnings are expected.

Frontend at http://localhost:5173, API docs at http://localhost:8000/docs.

## Checking it works

```bash
curl http://localhost:8000/health
curl "http://localhost:8000/parcels?limit=2"     # total_count ~117427, not 0
```

In the browser: search for a parcel, select it, and confirm green shows buildable against
red for excluded. Drag the easement slider — the map should update while you drag, not
after you let go. Then use **Exclude area**, click three or four corners, and close the
shape by clicking the first point again. Buildable acreage should drop and a
`user_carve_out` row should appear that keeps the breakdown summing correctly.

## Tests

Neither suite needs ingested data.

```bash
cd backend && pytest              # 30 tests
cd frontend && npm test -- --run  # 23 tests
cd frontend && npx tsc --noEmit
```

## When something breaks

**Port 8000 already taken.** Change both sides or the frontend calls a backend that is not
there:

```bash
uvicorn app.main:app --reload --port 8000
echo "VITE_API_BASE_URL=http://localhost:8000" > frontend/.env.local
```

Restart Vite afterwards — `VITE_*` variables are read at startup, not hot-reloaded.

Worth knowing: if another process holds the IPv6 wildcard `[::]:8000`, then
`localhost:8000` resolves to _it_ while uvicorn only has `127.0.0.1:8000`, and every
request returns someone else's 404. Use a different port rather than fighting it.

**`venv\Scripts\python.exe` not recognised.** The virtualenv was built on another OS.
Delete it and recreate.

**Parcel list is empty.** The backend is running without data. Check its startup log for
`Parcel file not found` and run the ingest scripts.

**CORS errors.** The backend allows ports 5173 and 3000. If Vite is elsewhere, set
`CORS_ORIGINS` in `.env` and restart.

**Blank map tiles.** Basemap tiles come from `tiles.openfreemap.org` and need internet
access. The analysis still works offline; only the background cartography disappears.
