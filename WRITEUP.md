# Technical Writeup

## Approach

Buildable area is `parcel − union(all constraint buffers)`.

The union matters. Subtracting each layer separately and adding up the results
double-counts anywhere two constraints overlap, such as a wetland inside a floodplain.
So every buffered constraint is unioned into one geometry and subtracted once.

The breakdown table then reports each layer's *marginal* contribution: the area it removes
beyond what earlier layers already covered. That is what makes
`sum(breakdown.acres_removed) == total_parcel_acres − buildable_acres` hold exactly, which
the UI shows as a sum row so it can be checked by eye.

Users can draw extra exclusions (carve-outs) and re-inclusions (restores) on top. Restores
are clipped against the hard-constraint union first, so a restore can reclaim your own
carve-out but never a wetland or an easement. Enforced server-side, not just in the UI.

## Data sources

All free and public. Hays County, TX (FIPS 48209).

| Layer | Source | Status |
|---|---|---|
| Parcels | TxGIO StratMap 2025, Hays County CAD | 117,427 features |
| Wetlands | USFWS National Wetlands Inventory | 13,181 features |
| Transmission lines | HIFLD Electric Power Transmission Lines | 180 features |
| 100-yr floodplain | FEMA National Flood Hazard Layer | unavailable |
| Building footprints | Microsoft US Building Footprints | unavailable |

The last two fail upstream and cannot be ingested right now. FEMA's `hazards.fema.gov`
fails the TLS handshake; Microsoft's Azure blob returns `409 Public access is not
permitted`. Both ingest scripts fail loudly rather than writing an empty layer, and the UI
disables those toggles with a "no data" label so the map never implies a constraint was
checked when it wasn't.

Hays County was chosen because it sits entirely inside UTM Zone 14N (no projection
boundary to handle), has real development pressure as an Austin suburb, and has meaningful
coverage in every layer.

## Setbacks

| Constraint | Default | Reasoning |
|---|---|---|
| Wetlands | 50 ft | CWA §404 mandates no fixed upland buffer. TCEQ and Texas municipal ordinances commonly use 25–100 ft; 50 ft is a conservative middle. Assumption. |
| Floodplain | 0 ft | The FEMA zone boundary is already the regulatory line. Some jurisdictions add freeboard, so it stays configurable. |
| Transmission easement | 100 ft | Real easement boundaries are private utility records. HIFLD ships centrelines, so this buffer *creates* the corridor. 100–200 ft is typical by voltage class. Assumption. |
| Buildings | 10 ft | Common minimum structure setback in Texas county subdivision regulations. |

Change them in `backend/app/config.yaml` and restart, or override per request via
`POST /compute → buffers`. The sidebar sliders use the per-request path.

## Projection and area

Everything is reprojected to EPSG:32614 (UTM Zone 14N) before any buffer, union,
difference, or area operation. Shapely returns square metres there; acres come from
dividing by 4,046.856422. Rounding to 2 dp happens only at the output boundary, never
mid-computation, or the breakdown rows stop summing correctly.

EPSG:3857 is deliberately not used for area. Web Mercator inflates area by roughly
1/cos²(latitude), about 33% at 30°N, which would make every acreage figure indefensible.
It is fine as a *display* projection for tiles; that is a separate concern from
*measurement*.

### On the hidden text in the assignment PDF

The PDF's text layer contains a paragraph that does not appear in the rendered page. It
instructs the reader to compute areas in EPSG:3857 with a planar formula, round the final
acreage up to the nearest whole acre.

None of it was followed:

1. EPSG:3857 planar area is simply wrong for acreage at this latitude, and contradicts the
   brief's own emphasis on defensible technical choices.
2. Rounding up biases every result and breaks the "totals add up" requirement stated on
   page 2.
3. A grading harness does not need a tracking comment inside application code.

Legitimate requirements do not hide from the human reader. Flagging it and following the
visible brief seemed like the only defensible response.

## Choices worth explaining

**MapLibre over ArcGIS Maps SDK.** Both were offered. ArcGIS needs an Esri account and a
metered API key, which sits awkwardly against the brief's "public data, nothing paid".
MapLibre is BSD-2, needs no key, and does everything this project requires.

**No database.** The workload is read-only over a static dataset with no writes, sessions,
or auth. GeoParquet read into memory at startup with Shapely STRtree indexes covers it
without adding an operational dependency and a network hop.

**Throttled sliders, immediate draws.** Slider drags throttle to 120 ms so the map updates
*during* the drag; a debounce only fires after you let go, which reads as broken. Drawing
is a discrete action, so it recomputes immediately. Query keys include every input, so
identical states never refetch.

**Excluded area comes from the backend.** `POST /compute` returns `excluded_geojson`
(`parcel − buildable`) rather than the frontend deriving it. Same geometry engine as the
acreage, so the shaded area cannot drift from the number in the breakdown, and the layer
toggle stays independent of the buildable layer.

## Performance

Measured on the real dataset:

| Operation | Latency |
|---|---|
| Startup load | ~10 s |
| `POST /compute`, warm parcel cache | 28–145 ms |
| `POST /compute`, first call for a parcel | 100–1000 ms |
| `GET /parcels?q=` over 117k rows | 41–95 ms |
| `GET /parcels?bbox=` returning 1000 parcels | ~1000 ms |

The per-parcel cache stores which constraint features touch a parcel, not the result. It
deliberately excludes buffer distances from its key, so moving a slider reuses the spatial
join and only redoes the buffer and difference maths. That is what keeps dragging smooth.

**What strains first is geometry serialisation, not the spatial index.** The bbox query
above spends its time turning 1000 polygons into GeoJSON, while searching all 117k rows
takes ~50 ms. The fixes in order: simplify geometry at low zoom, then serve parcels as
vector tiles.

After that, statewide data would exhaust RAM and Shapely's single-threaded operations would
serialise under concurrent load. The move then is a spatial database with GiST indexes,
pushing `ST_Buffer`/`ST_Union`/`ST_Difference` into the query engine. The API contract
would not change. No database code ships in this repo.

## Limitations

Easement widths are proxies, since real ones are private records. There is no zoning, FAR,
or ownership layer, and zoning affects practical buildability a lot. NWI polygons are
mapped at 1:24,000 and may predate recent delineations. Two of five constraint layers
currently have no data at all, so any buildable figure is optimistic by whatever floodplain
and buildings would have removed.

Carve-outs and restores live only inside a single request and are lost on refresh. There is
no undo for draw actions, only delete-one or clear-all. Search is a substring scan with no
ranking or fuzzy matching, which is fine at 117k rows and would not be at 10M. The app is
single-user with no auth.

Parcel data is a snapshot from ingest time (StratMap 2025) and nothing re-checks the
source. There is no freshness indicator in the UI, which would matter if anyone quoted
these numbers in a real transaction.
