import type { LayerKey } from '../state/store'

/** Single source of truth for layer color/label — shared by the sidebar's
 * LayerToggles and the on-map MapLegend so they can never drift apart. */
export const LAYERS: { key: LayerKey; label: string; color: string; description: string }[] = [
  { key: 'parcel',     label: 'All parcels',      color: '#94a3b8', description: 'Show all parcel boundaries' },
  { key: 'buildable',  label: 'Buildable area',   color: '#22c55e', description: 'Green = buildable area' },
  { key: 'excluded',   label: 'Excluded area',    color: '#ef4444', description: 'Red = excluded by constraints' },
  { key: 'wetland',    label: 'Wetlands',         color: '#06b6d4', description: 'USFWS NWI wetland polygons' },
  { key: 'floodplain', label: 'Floodplain',       color: '#3b82f6', description: 'FEMA 100-yr floodplain zones' },
  { key: 'easement',   label: 'Transmission lines', color: '#f59e0b', description: 'HIFLD transmission line corridors' },
  { key: 'building',   label: 'Buildings',        color: '#8b5cf6', description: 'Microsoft building footprints' },
]
