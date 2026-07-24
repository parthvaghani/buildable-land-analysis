/**
 * Typed API client — every function maps 1:1 to a backend endpoint.
 * All shapes are validated at runtime by TypeScript (compile-time) and
 * any mismatch with the Section 4 contract will appear as a type error here.
 */

import type {
  BufferConfig,
  ComputeRequest,
  ComputeResponse,
  ConstraintFeaturesResponse,
  ConstraintsResponse,
  ParcelDetail,
  ParcelsResponse,
} from '../types/api'

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function post<Req, Res>(path: string, body: Req): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`POST ${path} → ${res.status}: ${detail}`)
  }
  return res.json() as Promise<Res>
}

// ---------------------------------------------------------------------------
// Endpoint functions
// ---------------------------------------------------------------------------

export function fetchParcels(params?: {
  bbox?: string
  q?: string
  limit?: number
  offset?: number
}): Promise<ParcelsResponse> {
  const search = new URLSearchParams()
  if (params?.bbox) search.set('bbox', params.bbox)
  if (params?.q) search.set('q', params.q)
  if (params?.limit != null) search.set('limit', String(params.limit))
  if (params?.offset != null) search.set('offset', String(params.offset))
  const qs = search.toString()
  return get<ParcelsResponse>(`/parcels${qs ? `?${qs}` : ''}`)
}

export function fetchParcel(id: string): Promise<ParcelDetail> {
  return get<ParcelDetail>(`/parcels/${encodeURIComponent(id)}`)
}

export function fetchConstraints(): Promise<ConstraintsResponse> {
  return get<ConstraintsResponse>('/constraints')
}

export function fetchConfig(): Promise<BufferConfig> {
  return get<BufferConfig>('/config')
}

export function compute(req: ComputeRequest): Promise<ComputeResponse> {
  return post<ComputeRequest, ComputeResponse>('/compute', req)
}

export function fetchConstraintFeatures(
  parcelId: string,
): Promise<ConstraintFeaturesResponse> {
  return get<ConstraintFeaturesResponse>(
    `/constraint-features?parcel_id=${encodeURIComponent(parcelId)}`,
  )
}
