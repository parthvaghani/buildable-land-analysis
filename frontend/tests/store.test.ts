/**
 * Zustand store tests — drawn shape management, buffer updates, reset.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, selectCarveOuts, selectRestores } from '../src/state/store'
import type { DrawnShape } from '../src/types/api'
import type { Polygon } from 'geojson'

const DUMMY_POLYGON: Polygon = {
  type: 'Polygon',
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
}

function getStore() {
  return useStore.getState()
}

beforeEach(() => {
  // Reset store to clean state before each test.
  useStore.setState({
    selectedParcelId: null,
    selectedParcel: null,
    buffers: { wetland_ft: 50, floodplain_ft: 0, easement_ft: 100, building_ft: 10 },
    defaultBuffers: { wetland_ft: 50, floodplain_ft: 0, easement_ft: 100, building_ft: 10 },
    drawnShapes: [],
    drawMode: null,
  })
})

describe('buffer management', () => {
  it('updates a single buffer value', () => {
    getStore().setBuffer('wetland_ft', 200)
    expect(getStore().buffers.wetland_ft).toBe(200)
    expect(getStore().buffers.floodplain_ft).toBe(0)
  })

  it('seeds defaults from setDefaultBuffers', () => {
    getStore().setDefaultBuffers({ wetland_ft: 75, floodplain_ft: 10, easement_ft: 150, building_ft: 20 })
    expect(getStore().buffers.wetland_ft).toBe(75)
    expect(getStore().defaultBuffers.wetland_ft).toBe(75)
  })
})

describe('drawn shapes', () => {
  const carveOut: DrawnShape = { id: 'co-1', mode: 'carve_out', geometry: DUMMY_POLYGON }
  const restore: DrawnShape   = { id: 're-1', mode: 'restore',   geometry: DUMMY_POLYGON }

  it('adds shapes', () => {
    getStore().addDrawnShape(carveOut)
    getStore().addDrawnShape(restore)
    expect(getStore().drawnShapes).toHaveLength(2)
  })

  it('removes a shape by id', () => {
    getStore().addDrawnShape(carveOut)
    getStore().addDrawnShape(restore)
    getStore().removeDrawnShape('co-1')
    expect(getStore().drawnShapes).toHaveLength(1)
    expect(getStore().drawnShapes[0].id).toBe('re-1')
  })

  it('clears all shapes', () => {
    getStore().addDrawnShape(carveOut)
    getStore().addDrawnShape(restore)
    getStore().clearDrawnShapes()
    expect(getStore().drawnShapes).toHaveLength(0)
  })

  it('selectCarveOuts returns only carve_out geometries', () => {
    getStore().addDrawnShape(carveOut)
    getStore().addDrawnShape(restore)
    const cos = selectCarveOuts(getStore())
    expect(cos).toHaveLength(1)
    expect(cos[0]).toEqual(DUMMY_POLYGON)
  })

  it('selectRestores returns only restore geometries', () => {
    getStore().addDrawnShape(carveOut)
    getStore().addDrawnShape(restore)
    const rs = selectRestores(getStore())
    expect(rs).toHaveLength(1)
  })
})

describe('reset', () => {
  it('clears drawings and restores default buffers', () => {
    getStore().addDrawnShape({ id: 'x', mode: 'carve_out', geometry: DUMMY_POLYGON })
    getStore().setBuffer('wetland_ft', 300)
    getStore().reset()
    expect(getStore().drawnShapes).toHaveLength(0)
    expect(getStore().buffers.wetland_ft).toBe(50) // back to default
  })
})

describe('layer toggles', () => {
  it('toggles a layer off then on', () => {
    expect(getStore().layerVisibility.wetland).toBe(false)
    getStore().toggleLayer('wetland')
    expect(getStore().layerVisibility.wetland).toBe(true)
    getStore().toggleLayer('wetland')
    expect(getStore().layerVisibility.wetland).toBe(false)
  })
})

describe('draw mode', () => {
  it('sets and clears draw mode', () => {
    getStore().setDrawMode('carve_out')
    expect(getStore().drawMode).toBe('carve_out')
    getStore().setDrawMode(null)
    expect(getStore().drawMode).toBeNull()
  })

  it('clears drawn shapes when a new parcel is selected', () => {
    getStore().addDrawnShape({ id: 'x', mode: 'carve_out', geometry: DUMMY_POLYGON })
    getStore().setSelectedParcel({ id: 'p2', geometry: DUMMY_POLYGON, area_acres: 10, attributes: {} })
    expect(getStore().drawnShapes).toHaveLength(0)
  })
})
