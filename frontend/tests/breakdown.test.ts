/**
 * Breakdown display logic tests.
 *
 * Verify the invariant the frontend must visually enforce:
 *   sum(breakdown[].acres_removed) â‰ˆ total_parcel_acres - buildable_acres
 */

import { describe, it, expect } from 'vitest'
import type { ComputeResponse } from '../src/types/api'

function computeTotalRemoved(resp: ComputeResponse): number {
  return +(resp.total_parcel_acres - resp.buildable_acres).toFixed(2)
}

function computeBreakdownSum(resp: ComputeResponse): number {
  return +resp.breakdown.reduce((s, r) => s + r.acres_removed, 0).toFixed(2)
}

function hasMismatch(resp: ComputeResponse): boolean {
  return Math.abs(computeBreakdownSum(resp) - computeTotalRemoved(resp)) > 0.05
}

describe('breakdown sum invariant', () => {
  it('passes when totals match', () => {
    const resp: ComputeResponse = {
      buildable_geojson: { type: 'Polygon', coordinates: [] },
      excluded_geojson: null,
      buildable_acres: 40,
      total_parcel_acres: 100,
      breakdown: [
        { type: 'wetland',    acres_removed: 35, source: 'NWI' },
        { type: 'floodplain', acres_removed: 25, source: 'FEMA' },
      ],
    }
    expect(computeBreakdownSum(resp)).toBe(60)
    expect(computeTotalRemoved(resp)).toBe(60)
    expect(hasMismatch(resp)).toBe(false)
  })

  it('flags mismatch when rows do not sum to total removed', () => {
    const resp: ComputeResponse = {
      buildable_geojson: { type: 'Polygon', coordinates: [] },
      excluded_geojson: null,
      buildable_acres: 40,
      total_parcel_acres: 100,
      breakdown: [
        { type: 'wetland', acres_removed: 20, source: 'NWI' }, // only 20, not 60
      ],
    }
    expect(hasMismatch(resp)).toBe(true)
  })

  it('passes with zero breakdown when parcel is fully buildable', () => {
    const resp: ComputeResponse = {
      buildable_geojson: { type: 'Polygon', coordinates: [] },
      excluded_geojson: null,
      buildable_acres: 100,
      total_parcel_acres: 100,
      breakdown: [],
    }
    expect(computeTotalRemoved(resp)).toBe(0)
    expect(computeBreakdownSum(resp)).toBe(0)
    expect(hasMismatch(resp)).toBe(false)
  })

  it('passes with overlapping constraints where backend provides marginal breakdown', () => {
    // Wetland inside floodplain â€” backend guarantees marginal values sum correctly.
    const resp: ComputeResponse = {
      buildable_geojson: { type: 'Polygon', coordinates: [] },
      excluded_geojson: null,
      buildable_acres: 75.5,
      total_parcel_acres: 100,
      breakdown: [
        { type: 'wetland',    acres_removed: 12.3, source: 'NWI' },
        { type: 'floodplain', acres_removed: 12.2, source: 'FEMA' }, // marginal, not full zone
      ],
    }
    const removed = computeTotalRemoved(resp)  // 24.5
    const sum = computeBreakdownSum(resp)       // 24.5
    expect(Math.abs(sum - removed)).toBeLessThan(0.05)
    expect(hasMismatch(resp)).toBe(false)
  })
})

describe('percentage calculation', () => {
  it('computes per-row percentage of total parcel', () => {
    const row = { type: 'wetland', acres_removed: 25, source: 'NWI' }
    const total = 100
    const pct = (row.acres_removed / total) * 100
    expect(pct).toBe(25)
  })

  it('handles zero total without divide-by-zero', () => {
    const total = 0
    const pct = total > 0 ? (25 / total) * 100 : 0
    expect(pct).toBe(0)
  })
})

