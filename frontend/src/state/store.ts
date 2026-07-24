/**
 * Zustand store — all client-side UI state.
 *
 * Server state (API responses) is managed by TanStack Query in hooks/.
 * This store holds only what is needed across components but doesn't come
 * from the server: selected parcel, live buffer values, drawn shapes, layer
 * visibility, and draw mode.
 */

import { create } from 'zustand'
import type { BufferConfig, DrawnShape, DrawMode, ParcelSummary } from '../types/api'

const DEFAULT_BUFFERS: BufferConfig = {
  wetland_ft: 50,
  floodplain_ft: 0,
  easement_ft: 100,
  building_ft: 10,
}

export type LayerKey =
  | 'parcel'
  | 'buildable'
  | 'excluded'
  | 'wetland'
  | 'floodplain'
  | 'easement'
  | 'building'

interface AppState {
  // Selected parcel
  selectedParcelId: string | null
  selectedParcel: ParcelSummary | null

  // Buffer values (seeded from GET /config, overridable via sliders)
  buffers: BufferConfig
  // Defaults fetched from backend — used by the Reset button
  defaultBuffers: BufferConfig

  // User-drawn shapes
  drawnShapes: DrawnShape[]
  drawMode: DrawMode

  // Layer visibility on the map
  layerVisibility: Record<LayerKey, boolean>

  // Search query
  parcelSearch: string

  // Sidebar visibility — below `lg` it's an off-canvas drawer (see App.tsx);
  // lives here rather than local state so the onboarding tour can force it
  // open when a step needs to point at a sidebar element.
  sidebarOpen: boolean

  // --- Actions ---

  setSelectedParcel: (parcel: ParcelSummary | null) => void
  setBuffer: (key: keyof BufferConfig, value: number) => void
  setDefaultBuffers: (defaults: BufferConfig) => void
  addDrawnShape: (shape: DrawnShape) => void
  removeDrawnShape: (id: string) => void
  clearDrawnShapes: () => void
  setDrawMode: (mode: DrawMode) => void
  toggleLayer: (key: LayerKey) => void
  setParcelSearch: (q: string) => void
  setSidebarOpen: (open: boolean) => void
  reset: () => void
}

export const useStore = create<AppState>((set) => ({
  selectedParcelId: null,
  selectedParcel: null,
  buffers: { ...DEFAULT_BUFFERS },
  defaultBuffers: { ...DEFAULT_BUFFERS },
  drawnShapes: [],
  drawMode: null,
  layerVisibility: {
    parcel: true,
    buildable: true,
    excluded: true,
    wetland: false,
    floodplain: false,
    easement: false,
    building: false,
  },
  parcelSearch: '',
  sidebarOpen: false,

  setSelectedParcel: (parcel) =>
    set({
      selectedParcel: parcel,
      selectedParcelId: parcel?.id ?? null,
      drawnShapes: [],
      drawMode: null,
    }),

  setBuffer: (key, value) =>
    set((s) => ({ buffers: { ...s.buffers, [key]: value } })),

  setDefaultBuffers: (defaults) =>
    set({ defaultBuffers: defaults, buffers: { ...defaults } }),

  addDrawnShape: (shape) =>
    set((s) => ({ drawnShapes: [...s.drawnShapes, shape] })),

  removeDrawnShape: (id) =>
    set((s) => ({ drawnShapes: s.drawnShapes.filter((sh) => sh.id !== id) })),

  clearDrawnShapes: () => set({ drawnShapes: [] }),

  setDrawMode: (mode) => set({ drawMode: mode }),

  toggleLayer: (key) =>
    set((s) => ({
      layerVisibility: {
        ...s.layerVisibility,
        [key]: !s.layerVisibility[key],
      },
    })),

  setParcelSearch: (q) => set({ parcelSearch: q }),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  reset: () =>
    set((s) => ({
      drawnShapes: [],
      drawMode: null,
      buffers: { ...s.defaultBuffers },
    })),
}))

// Selectors
export const selectCarveOuts = (s: AppState) =>
  s.drawnShapes.filter((sh) => sh.mode === 'carve_out').map((sh) => sh.geometry)

export const selectRestores = (s: AppState) =>
  s.drawnShapes.filter((sh) => sh.mode === 'restore').map((sh) => sh.geometry)
