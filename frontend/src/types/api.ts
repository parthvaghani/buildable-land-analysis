/**
 * TypeScript types mirroring the backend API contract (Section 4 of the spec).
 * These are the single source of truth for all API shapes in the frontend.
 * Do not infer types from backend source — use this file only.
 */

import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson'

// ---------------------------------------------------------------------------
// GET /parcels
// ---------------------------------------------------------------------------

export interface ParcelSummary {
  id: string
  geometry: Polygon | MultiPolygon
  area_acres: number
  attributes: Record<string, unknown>
}

export interface ParcelsResponse {
  parcels: ParcelSummary[]
  total_count: number
}

// ---------------------------------------------------------------------------
// GET /parcels/{id}
// ---------------------------------------------------------------------------

export type ParcelDetail = ParcelSummary

// ---------------------------------------------------------------------------
// GET /constraints
// ---------------------------------------------------------------------------

export interface ConstraintLayerMeta {
  name: string
  type: string
  default_buffer_ft: number
  source: string
  /** Features actually loaded at startup; 0 means the layer is configured but has no data. */
  feature_count: number
}

export interface ConstraintsResponse {
  layers: ConstraintLayerMeta[]
}

// ---------------------------------------------------------------------------
// GET /config
// ---------------------------------------------------------------------------

export interface BufferConfig {
  wetland_ft: number
  floodplain_ft: number
  easement_ft: number
  building_ft: number
}

// ---------------------------------------------------------------------------
// POST /compute
// ---------------------------------------------------------------------------

export interface ComputeRequest {
  parcel_id: string
  buffers: BufferConfig
  carve_outs: Polygon[]
  restores: Polygon[]
}

export interface BreakdownRow {
  type: string
  acres_removed: number
  source: string
}

export interface ComputeResponse {
  buildable_geojson: Polygon | MultiPolygon
  /** parcel − buildable; null when nothing was removed. */
  excluded_geojson: Polygon | MultiPolygon | null
  buildable_acres: number
  total_parcel_acres: number
  /** Guaranteed: sum(breakdown[].acres_removed) == total_parcel_acres - buildable_acres */
  breakdown: BreakdownRow[]
}

// ---------------------------------------------------------------------------
// GET /constraint-features?parcel_id=X  (frontend-support endpoint)
// ---------------------------------------------------------------------------

export interface ConstraintFeaturesResponse {
  layers: Record<string, FeatureCollection>
}

// ---------------------------------------------------------------------------
// Shared draw state types (not API types — used by the draw tool)
// ---------------------------------------------------------------------------

export type DrawMode = 'carve_out' | 'restore' | null

export interface DrawnShape {
  id: string
  mode: 'carve_out' | 'restore'
  geometry: Polygon
}
