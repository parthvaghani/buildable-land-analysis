/**
 * API client tests — verify that each function produces the right
 * fetch calls and parses the response correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchConfig, fetchParcels, compute, fetchConstraintFeatures } from '../src/api/client'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(data: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => data,
    text: async () => JSON.stringify(data),
  })
}

beforeEach(() => mockFetch.mockClear())

describe('fetchConfig', () => {
  it('calls GET /config and returns buffer values', async () => {
    const config = { wetland_ft: 50, floodplain_ft: 0, easement_ft: 100, building_ft: 10 }
    mockResponse(config)
    const result = await fetchConfig()
    expect(result).toEqual(config)
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/config'))
  })
})

describe('fetchParcels', () => {
  it('calls GET /parcels and returns list', async () => {
    const resp = { parcels: [{ id: 'p1', geometry: { type: 'Polygon', coordinates: [] }, area_acres: 10, attributes: {} }], total_count: 1 }
    mockResponse(resp)
    const result = await fetchParcels({ limit: 10 })
    expect(result.total_count).toBe(1)
    expect(result.parcels[0].id).toBe('p1')
  })

  it('includes bbox query param when provided', async () => {
    mockResponse({ parcels: [], total_count: 0 })
    await fetchParcels({ bbox: '-98,30,-97,31', limit: 5 })
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('bbox=-98%2C30%2C-97%2C31')
  })
})

describe('compute', () => {
  it('calls POST /compute with correct body and returns result', async () => {
    const response = {
      buildable_geojson: { type: 'Polygon', coordinates: [] },
      buildable_acres: 40,
      total_parcel_acres: 100,
      breakdown: [{ type: 'wetland', acres_removed: 60, source: 'NWI' }],
    }
    mockResponse(response)

    const req = {
      parcel_id: 'p1',
      buffers: { wetland_ft: 50, floodplain_ft: 0, easement_ft: 100, building_ft: 10 },
      carve_outs: [],
      restores: [],
    }
    const result = await compute(req)

    expect(result.buildable_acres).toBe(40)
    expect(result.total_parcel_acres).toBe(100)
    expect(result.breakdown).toHaveLength(1)

    const call = mockFetch.mock.calls[0]
    expect(call[0]).toContain('/compute')
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(call[1].body)).toEqual(req)
  })

  it('throws when server returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Not found' })
    await expect(compute({ parcel_id: 'x', buffers: { wetland_ft: 50, floodplain_ft: 0, easement_ft: 100, building_ft: 10 }, carve_outs: [], restores: [] }))
      .rejects.toThrow()
  })
})

describe('fetchConstraintFeatures', () => {
  it('calls GET /constraint-features with parcel_id', async () => {
    const resp = { layers: { wetland: { type: 'FeatureCollection', features: [] } } }
    mockResponse(resp)
    const result = await fetchConstraintFeatures('parcel-123')
    expect(result.layers).toHaveProperty('wetland')
    expect(mockFetch.mock.calls[0][0]).toContain('parcel_id=parcel-123')
  })
})
