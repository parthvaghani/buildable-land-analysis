/**
 * MapLibre layer/source definitions for all overlay types.
 */

import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'

export const SOURCE = {
  PARCELS:      'parcels',
  SELECTED:     'selected-parcel',
  BUILDABLE:    'buildable',
  EXCLUDED:     'excluded',
  CARVEOUTS:    'carve-outs',
  RESTORES:     'restores',
  WETLAND:      'wetland-features',
  FLOODPLAIN:   'floodplain-features',
  EASEMENT:     'easement-features',
  BUILDING:     'building-features',
  DRAW_PENDING: 'draw-pending',
} as const

export const LAYER = {
  PARCELS_FILL:       'parcels-fill',
  PARCELS_OUTLINE:    'parcels-outline',
  SELECTED_OUTLINE:   'selected-outline',
  EXCLUDED_FILL:      'excluded-fill',
  BUILDABLE_FILL:     'buildable-fill',
  BUILDABLE_OUTLINE:  'buildable-outline',
  CARVEOUT_FILL:      'carve-out-fill',
  CARVEOUT_OUTLINE:   'carve-out-outline',
  RESTORE_FILL:       'restore-fill',
  RESTORE_OUTLINE:    'restore-outline',
  WETLAND_FILL:       'wetland-fill',
  FLOODPLAIN_FILL:    'floodplain-fill',
  EASEMENT_FILL:      'easement-fill',
  BUILDING_FILL:      'building-fill',
  // Constraint sources also get a line layer: a `fill` layer silently renders
  // nothing for LineString features, which is how the transmission-line overlay
  // (HIFLD ships centrelines, not corridors) appeared to do nothing at all.
  WETLAND_LINE:       'wetland-line',
  FLOODPLAIN_LINE:    'floodplain-line',
  EASEMENT_LINE:      'easement-line',
  BUILDING_LINE:      'building-line',
  DRAW_LINE:          'draw-pending-line',
  DRAW_POINTS:        'draw-pending-points',
} as const

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

export function initMapLayers(map: MapLibreMap): void {
  const sourceIds = Object.values(SOURCE)
  for (const id of sourceIds) {
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'geojson', data: EMPTY_FC })
    }
  }

  // All parcels (faint, clickable)
  map.addLayer({ id: LAYER.PARCELS_FILL, type: 'fill', source: SOURCE.PARCELS,
    paint: { 'fill-color': '#94a3b8', 'fill-opacity': 0.15 } })
  map.addLayer({ id: LAYER.PARCELS_OUTLINE, type: 'line', source: SOURCE.PARCELS,
    paint: { 'line-color': '#64748b', 'line-width': 0.8 } })

  // Excluded area — the real (parcel − buildable) geometry, not the whole parcel
  // tinted red and covered by green.  Bound to its own source so the layer still
  // tells the truth when "Buildable area" is toggled off.
  map.addLayer({ id: LAYER.EXCLUDED_FILL, type: 'fill', source: SOURCE.EXCLUDED,
    paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.45 } })

  // Buildable area (green on top of red)
  map.addLayer({ id: LAYER.BUILDABLE_FILL, type: 'fill', source: SOURCE.BUILDABLE,
    paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.55 } })
  map.addLayer({ id: LAYER.BUILDABLE_OUTLINE, type: 'line', source: SOURCE.BUILDABLE,
    paint: { 'line-color': '#16a34a', 'line-width': 1.5 } })

  // Selected parcel dashed outline
  map.addLayer({ id: LAYER.SELECTED_OUTLINE, type: 'line', source: SOURCE.SELECTED,
    paint: { 'line-color': '#1d4ed8', 'line-width': 2.5, 'line-dasharray': [4, 2] } })

  // Constraint overlays (hidden by default).  Each source gets a fill *and* a
  // line layer so polygon and linear constraints both render; MapLibre simply
  // skips features whose geometry does not match the layer type.
  const constraintOverlays: [string, string, string, string][] = [
    // [fillLayerId, lineLayerId, sourceId, colour]
    [LAYER.WETLAND_FILL,    LAYER.WETLAND_LINE,    SOURCE.WETLAND,    '#06b6d4'],
    [LAYER.FLOODPLAIN_FILL, LAYER.FLOODPLAIN_LINE, SOURCE.FLOODPLAIN, '#3b82f6'],
    [LAYER.EASEMENT_FILL,   LAYER.EASEMENT_LINE,   SOURCE.EASEMENT,   '#f59e0b'],
    [LAYER.BUILDING_FILL,   LAYER.BUILDING_LINE,   SOURCE.BUILDING,   '#8b5cf6'],
  ]

  for (const [fillId, lineId, sourceId, color] of constraintOverlays) {
    map.addLayer({ id: fillId, type: 'fill', source: sourceId,
      layout: { visibility: 'none' },
      paint: { 'fill-color': color, 'fill-opacity': 0.5 } })
    map.addLayer({ id: lineId, type: 'line', source: sourceId,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': 2.5 } })
  }

  // User carve-outs
  map.addLayer({ id: LAYER.CARVEOUT_FILL, type: 'fill', source: SOURCE.CARVEOUTS,
    paint: { 'fill-color': '#b91c1c', 'fill-opacity': 0.4 } })
  map.addLayer({ id: LAYER.CARVEOUT_OUTLINE, type: 'line', source: SOURCE.CARVEOUTS,
    paint: { 'line-color': '#7f1d1d', 'line-width': 2, 'line-dasharray': [3, 2] } })

  // User restores
  map.addLayer({ id: LAYER.RESTORE_FILL, type: 'fill', source: SOURCE.RESTORES,
    paint: { 'fill-color': '#4ade80', 'fill-opacity': 0.4 } })
  map.addLayer({ id: LAYER.RESTORE_OUTLINE, type: 'line', source: SOURCE.RESTORES,
    paint: { 'line-color': '#15803d', 'line-width': 2, 'line-dasharray': [3, 2] } })

  // In-progress draw preview
  map.addLayer({ id: LAYER.DRAW_LINE, type: 'line', source: SOURCE.DRAW_PENDING,
    paint: { 'line-color': '#f97316', 'line-width': 2, 'line-dasharray': [2, 2] } })
  map.addLayer({ id: LAYER.DRAW_POINTS, type: 'circle', source: SOURCE.DRAW_PENDING,
    filter: ['==', '$type', 'Point'],
    paint: { 'circle-radius': 4, 'circle-color': '#f97316', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } })
}

export function setSourceData(map: MapLibreMap, sourceId: string, data: FeatureCollection): void {
  const src = map.getSource(sourceId) as GeoJSONSource | undefined
  src?.setData(data)
}
