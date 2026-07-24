/**
 * Main MapLibre GL map component.
 *
 * Map tile source: OpenFreeMap (https://openfreemap.org) — completely free,
 * no API key, no account needed. Uses OpenStreetMap data under ODbL.
 * Chosen over MapTiler/ArcGIS because it fits the "public data, nothing paid"
 * spirit of the assignment.
 *
 * Draw tools use a custom lightweight polygon drawer built on MapLibre's
 * native click/mousemove events. This sidesteps version-compatibility issues
 * between @mapbox/mapbox-gl-draw and MapLibre GL 4.x, and gives full control
 * over styling and UX with ~100 lines of straightforward event handling.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'

import { fetchParcel } from '../../api/client'
import { useCompute, useConstraintFeatures } from '../../hooks/useCompute'
import { useParcels } from '../../hooks/useParcels'
import { selectCarveOuts, selectRestores, useStore } from '../../state/store'
import type { DrawMode, DrawnShape } from '../../types/api'
import { initMapLayers, setSourceData, SOURCE, LAYER } from './mapLayers'
import { MapLegend } from './MapLegend'
import type { LayerKey } from '../../state/store'

const MAP_STYLE =
  import.meta.env.VITE_MAP_STYLE ?? 'https://tiles.openfreemap.org/styles/liberty'
const INITIAL_LNG = Number(import.meta.env.VITE_MAP_INITIAL_LNG ?? -97.9)
const INITIAL_LAT = Number(import.meta.env.VITE_MAP_INITIAL_LAT ?? 30.05)
const INITIAL_ZOOM = Number(import.meta.env.VITE_MAP_INITIAL_ZOOM ?? 10)

let shapeCounter = 0
const nextId = () => `shape-${++shapeCounter}`

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // Readiness has to live in state, not just the ref: effects that touch the map
  // need a dependency that actually changes when the style finishes loading,
  // otherwise any effect with stable deps runs once against a null map and never
  // re-runs (which silently dropped the draw handlers).
  const [mapReady, setMapReady] = useState(false)
  const drawStateRef = useRef<{ mode: DrawMode; points: [number, number][] }>({
    mode: null,
    points: [],
  })

  const {
    selectedParcel,
    drawMode,
    layerVisibility,
    setSelectedParcel,
    addDrawnShape,
    setDrawMode,
  } = useStore()

  const carveOuts = useStore(selectCarveOuts)
  const restores = useStore(selectRestores)

  // Parcels are loaded for whatever the map is currently showing rather than a
  // fixed first-N slice, so clicking any visible parcel resolves and panning to a
  // new area loads that area.
  const [viewportBbox, setViewportBbox] = useState<string | null>(null)
  const { data: parcelsData } = useParcels({
    bbox: viewportBbox ?? undefined,
    limit: VIEWPORT_PARCEL_LIMIT,
    enabled: viewportBbox !== null,
  })
  const { data: computeResult, isFetching: isComputing } = useCompute()
  const { data: constraintFeatures } = useConstraintFeatures()

  // -------------------------------------------------------------------------
  // Map initialization
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [INITIAL_LNG, INITIAL_LAT],
      zoom: INITIAL_ZOOM,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl(), 'bottom-right')

    map.on('load', () => {
      initMapLayers(map)
      mapRef.current = map
      setMapReady(true)
    })

    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Track the viewport so parcel loading follows the map
  // -------------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const syncBbox = () => {
      const b = map.getBounds()
      setViewportBbox(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
          // Trimming precision keeps the query key stable across sub-metre jitter,
          // so a nudge of the map doesn't trigger a refetch.
          .map((n) => n.toFixed(4))
          .join(','),
      )
    }

    syncBbox()
    map.on('moveend', syncBbox)
    return () => {
      map.off('moveend', syncBbox)
    }
  }, [mapReady])

  // -------------------------------------------------------------------------
  // Parcel click selection
  // -------------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onParcelClick = (e: maplibregl.MapMouseEvent) => {
      if (drawStateRef.current.mode !== null) return
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER.PARCELS_FILL] })
      if (!features.length) return
      const props = features[0].properties as Record<string, unknown>
      const id = String(props['parcel_id'] ?? props['id'] ?? '')
      if (!id) return

      // Camera framing is handled centrally by the selectedParcel effect below,
      // so selecting from the sidebar zooms the same way a map click does.
      const matching = parcelsData?.parcels.find((p) => p.id === id)
      if (matching) {
        setSelectedParcel(matching)
        return
      }

      // The rendered tile can outlive the page it came from (or the viewport can
      // hold more parcels than the limit returns), so fall back to fetching the
      // clicked parcel by id instead of silently selecting nothing.
      fetchParcel(id)
        .then(setSelectedParcel)
        .catch(() => setSelectedParcel(null))
    }

    const enterCursor = () => {
      map.getCanvas().style.cursor = drawStateRef.current.mode ? 'crosshair' : 'pointer'
    }
    const leaveCursor = () => { map.getCanvas().style.cursor = '' }

    map.on('click', LAYER.PARCELS_FILL, onParcelClick)
    map.on('mouseenter', LAYER.PARCELS_FILL, enterCursor)
    map.on('mouseleave', LAYER.PARCELS_FILL, leaveCursor)

    return () => {
      map.off('click', LAYER.PARCELS_FILL, onParcelClick)
      map.off('mouseenter', LAYER.PARCELS_FILL, enterCursor)
      map.off('mouseleave', LAYER.PARCELS_FILL, leaveCursor)
    }
  }, [mapReady, parcelsData, setSelectedParcel])

  // -------------------------------------------------------------------------
  // Custom draw tools
  // -------------------------------------------------------------------------

  const commitPolygon = useCallback(
    (points: [number, number][], mode: 'carve_out' | 'restore') => {
      if (points.length < 3) return
      const geometry: Polygon = { type: 'Polygon', coordinates: [[...points, points[0]]] }
      const shape: DrawnShape = { id: nextId(), mode, geometry }
      addDrawnShape(shape)
      if (mapRef.current) setSourceData(mapRef.current, SOURCE.DRAW_PENDING, EMPTY_FC)
    },
    [addDrawnShape],
  )

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const finish = (pts: [number, number][], mode: 'carve_out' | 'restore') => {
      commitPolygon(pts, mode)
      drawStateRef.current = { mode, points: [] }
    }

    // A click can only be recognised as "not the start of a double-click" once
    // the double-click window has passed, so each vertex is held here until then.
    // Without the hold, the first click of a double-click renders a vertex that
    // the dblclick handler immediately takes back — a visible blink.
    let pendingTimer: ReturnType<typeof setTimeout> | null = null

    const cancelPendingVertex = () => {
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
    }

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const { mode, points } = drawStateRef.current
      if (!mode) return
      e.preventDefault()

      // The second click of a double-click carries detail === 2; the dblclick
      // handler owns it.
      if (e.originalEvent.detail >= 2) return

      // Clicking the first vertex closes the ring.  Unambiguous, so it applies
      // immediately rather than waiting out the double-click window.
      if (points.length >= 3) {
        const first = map.project(points[0])
        const distance = Math.hypot(first.x - e.point.x, first.y - e.point.y)
        if (distance <= FINISH_HIT_RADIUS_PX) {
          cancelPendingVertex()
          finish(points, mode)
          return
        }
      }

      const coord: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      cancelPendingVertex()
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        const current = drawStateRef.current
        if (!current.mode) return // cancelled while the vertex was held
        const updated = [...current.points, coord]
        drawStateRef.current.points = updated
        updatePendingSource(map, updated)
      }, DOUBLE_CLICK_WINDOW_MS)
    }

    const handleDblClick = (e: maplibregl.MapMouseEvent) => {
      const { mode, points } = drawStateRef.current
      if (!mode) return
      e.preventDefault()

      // Discards the held vertex from the first click, so it never renders.
      cancelPendingVertex()

      // Safety net for a double-click slower than the hold window, where the
      // vertex has already landed: strip anything under the finish point.
      const deduped = dropVerticesAt(map, points, e.point)
      if (deduped.length < 3) return

      finish(deduped, mode)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const { mode, points } = drawStateRef.current

      if (e.key === 'Escape') {
        cancelPendingVertex()
        drawStateRef.current.points = []
        setSourceData(map, SOURCE.DRAW_PENDING, EMPTY_FC)
        setDrawMode(null)
        return
      }

      // Enter closes the ring using exactly the vertices already on screen.
      if (e.key === 'Enter' && mode && points.length >= 3) {
        cancelPendingVertex()
        finish(points, mode)
      }
    }

    map.on('click', handleClick)
    map.on('dblclick', handleDblClick)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      cancelPendingVertex()
      map.off('click', handleClick)
      map.off('dblclick', handleDblClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [mapReady, commitPolygon, setDrawMode])

  // Sync drawMode ref without re-registering event handlers.
  useEffect(() => {
    drawStateRef.current.mode = drawMode
    if (!drawMode) {
      drawStateRef.current.points = []
      if (mapRef.current) setSourceData(mapRef.current, SOURCE.DRAW_PENDING, EMPTY_FC)
    }
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = drawMode ? 'crosshair' : ''
      // Double-click finishes a polygon, so the map must not also zoom on it.
      if (drawMode) mapRef.current.doubleClickZoom.disable()
      else mapRef.current.doubleClickZoom.enable()
    }
  }, [mapReady, drawMode])

  // -------------------------------------------------------------------------
  // Source data updates
  // -------------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current
    if (!map || !parcelsData) return
    setSourceData(map, SOURCE.PARCELS, {
      type: 'FeatureCollection',
      features: parcelsData.parcels.map((p) => ({
        type: 'Feature' as const,
        geometry: p.geometry,
        properties: { parcel_id: p.id, area_acres: p.area_acres },
      })),
    })
  }, [mapReady, parcelsData])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!selectedParcel) {
      setSourceData(map, SOURCE.SELECTED, EMPTY_FC)
      return
    }
    setSourceData(map, SOURCE.SELECTED, {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: selectedParcel.geometry, properties: {} }],
    })
  }, [mapReady, selectedParcel])

  // Frame the selected parcel, whichever way it was selected (map click, sidebar
  // search, or a programmatic selection) and wherever the map is currently parked.
  // Keyed on the id so re-selecting the same parcel does not re-animate.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedParcel) return

    const bounds = geometryBounds(selectedParcel.geometry)
    if (!bounds) return

    map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 800 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, selectedParcel?.id])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!computeResult) {
      setSourceData(map, SOURCE.BUILDABLE, EMPTY_FC)
      return
    }
    setSourceData(map, SOURCE.BUILDABLE, {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: computeResult.buildable_geojson, properties: {} }],
    })
  }, [mapReady, computeResult])

  // Excluded geometry comes from the backend rather than being derived here, so
  // the red area is produced by the same shapely operation as buildable_acres and
  // cannot drift from the number in the breakdown.  Its own source keeps the
  // "Excluded area" toggle independent of the "Buildable area" toggle.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // null = nothing was removed, so the whole parcel is buildable.
    const excluded = computeResult?.excluded_geojson
    setSourceData(
      map,
      SOURCE.EXCLUDED,
      excluded
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: excluded, properties: {} }] }
        : EMPTY_FC,
    )
  }, [mapReady, computeResult])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    setSourceData(map, SOURCE.CARVEOUTS, {
      type: 'FeatureCollection',
      features: carveOuts.map((g) => ({ type: 'Feature' as const, geometry: g, properties: {} })),
    })
  }, [mapReady, carveOuts])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    setSourceData(map, SOURCE.RESTORES, {
      type: 'FeatureCollection',
      features: restores.map((g) => ({ type: 'Feature' as const, geometry: g, properties: {} })),
    })
  }, [mapReady, restores])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !constraintFeatures) return
    const mapping: [string, string][] = [
      [SOURCE.WETLAND,    'wetland'],
      [SOURCE.FLOODPLAIN, 'floodplain'],
      [SOURCE.EASEMENT,   'easement'],
      [SOURCE.BUILDING,   'building'],
    ]
    for (const [srcId, key] of mapping) {
      const fc = (constraintFeatures.layers[key] as FeatureCollection | undefined)
        ?? EMPTY_FC
      setSourceData(map, srcId, fc)
    }
  }, [mapReady, constraintFeatures])

  // Layer visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const visMap: [string, LayerKey][] = [
      [LAYER.PARCELS_OUTLINE,  'parcel'],
      [LAYER.EXCLUDED_FILL,    'excluded'],
      [LAYER.BUILDABLE_FILL,   'buildable'],
      [LAYER.BUILDABLE_OUTLINE,'buildable'],
      [LAYER.WETLAND_FILL,     'wetland'],
      [LAYER.WETLAND_LINE,     'wetland'],
      [LAYER.FLOODPLAIN_FILL,  'floodplain'],
      [LAYER.FLOODPLAIN_LINE,  'floodplain'],
      [LAYER.EASEMENT_FILL,    'easement'],
      [LAYER.EASEMENT_LINE,    'easement'],
      [LAYER.BUILDING_FILL,    'building'],
      [LAYER.BUILDING_LINE,    'building'],
    ]
    for (const [layerId, key] of visMap) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', layerVisibility[key] ? 'visible' : 'none')
      }
    }

    // The parcel fill stays rendered and is faded out instead of hidden.
    // queryRenderedFeatures ignores layers with visibility:none, so hiding it
    // would silently disable click-to-select on the map.
    if (map.getLayer(LAYER.PARCELS_FILL)) {
      map.setPaintProperty(
        LAYER.PARCELS_FILL,
        'fill-opacity',
        layerVisibility.parcel ? 0.15 : 0,
      )
    }
  }, [mapReady, layerVisibility])

  return (
    <div className="relative w-full h-full" data-tour="map">
      <div ref={containerRef} className="w-full h-full" />

      {/* Top-center stack — transient status messages, kept off top-left
          (hamburger + help) and top-right (MapLibre's zoom/compass control). */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        {isComputing && (
          <div className="bg-white/90 text-sm text-gray-700 px-4 py-1.5 rounded-full shadow-md flex items-center gap-2 pointer-events-none">
            <span className="inline-block w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            Computing…
          </div>
        )}

        {drawMode && (
          <div className={`flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 rounded-full shadow-md text-white pointer-events-none ${drawMode === 'carve_out' ? 'bg-red-600' : 'bg-green-600'}`}>
            <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              {drawMode === 'carve_out' ? (
                <path d="M4 4l12 12M16 4L4 16" strokeLinecap="round" />
              ) : (
                <>
                  <path d="M6 5L2.5 8.5 6 12" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2.5 8.5H12a4.5 4.5 0 010 9H8" strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}
            </svg>
            {drawMode === 'carve_out' ? 'Drawing exclusion' : 'Drawing restore'}
            <span className="text-xs opacity-80">
              · click first point, Enter, or dbl-click to finish · Esc to cancel
            </span>
          </div>
        )}
      </div>

      {/* Bottom-left stack — kept off bottom-right, which MapLibre's own
          attribution + scale controls already occupy. */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-2 items-start">
        <MapLegend />

        {parcelsData && parcelsData.total_count > parcelsData.parcels.length && (
          <div className="bg-white/90 text-[11px] text-gray-600 px-3 py-1.5 rounded-md shadow pointer-events-none">
            Showing {parcelsData.parcels.length.toLocaleString()} of{' '}
            {parcelsData.total_count.toLocaleString()} parcels in view — zoom in for the rest
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Parcels fetched per viewport.  The backend caps `limit` at 1000; at county-wide
 * zoom the view holds far more than that, so the fill is deliberately a sample
 * until you zoom in — see the "showing N of M" hint.
 */
const VIEWPORT_PARCEL_LIMIT = 1000

/** Screen-space radius, in px, treated as "the same spot" when finishing a draw. */
const FINISH_HIT_RADIUS_PX = 8

/**
 * How long a vertex is held before it renders, so a following double-click can
 * cancel it silently.  Comfortably above typical double-click speed (~120 ms)
 * while staying short enough that placing vertices still feels immediate.
 */
const DOUBLE_CLICK_WINDOW_MS = 260

/**
 * Strips trailing vertices that fall under `finish` on screen.
 *
 * Compared in pixels rather than lng/lat on purpose: the two clicks of a
 * double-click can land a pixel or two apart, and the degree-equivalent of that
 * jitter changes with zoom, so no fixed coordinate tolerance works at every scale.
 */
function dropVerticesAt(
  map: maplibregl.Map,
  points: [number, number][],
  finish: maplibregl.Point,
): [number, number][] {
  const result = [...points]
  // A double-click emits exactly two `click` events, so at most two vertices can
  // be gesture artefacts.  Capping the removal keeps a deliberate final vertex
  // that the user single-clicked before double-clicking on the same spot.
  let removable = 2
  while (result.length > 0 && removable > 0) {
    const projected = map.project(result[result.length - 1])
    const distance = Math.hypot(projected.x - finish.x, projected.y - finish.y)
    if (distance > FINISH_HIT_RADIUS_PX) break
    result.pop()
    removable--
  }
  return result
}

/**
 * Bounding box of a Polygon or MultiPolygon, or null if it has no coordinates.
 * Walks the nested position arrays so both geometry types share one path.
 */
function geometryBounds(geometry: Polygon | MultiPolygon): maplibregl.LngLatBounds | null {
  const bounds = new maplibregl.LngLatBounds()

  const rings =
    geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.coordinates.flat()

  for (const ring of rings) {
    for (const [lng, lat] of ring) bounds.extend([lng, lat])
  }

  return bounds.isEmpty() ? null : bounds
}

function updatePendingSource(map: maplibregl.Map, points: [number, number][]) {
  const features: FeatureCollection['features'] = []

  if (points.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [...points, points[0]] },
      properties: {},
    })
  }
  for (const pt of points) {
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: pt }, properties: {} })
  }

  setSourceData(map, SOURCE.DRAW_PENDING, { type: 'FeatureCollection', features })
}
