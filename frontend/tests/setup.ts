import '@testing-library/jest-dom'

// Stub MapLibre GL so map tests don't need a canvas/WebGL context.
vi.mock('maplibre-gl', () => ({
  default: {
    Map: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      off: vi.fn(),
      addControl: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      getSource: vi.fn().mockReturnValue({ setData: vi.fn() }),
      getLayer: vi.fn().mockReturnValue(true),
      setLayoutProperty: vi.fn(),
      queryRenderedFeatures: vi.fn().mockReturnValue([]),
      getCanvas: vi.fn().mockReturnValue({ style: {} }),
      fitBounds: vi.fn(),
      remove: vi.fn(),
    })),
    NavigationControl: vi.fn(),
    ScaleControl: vi.fn(),
    LngLatBounds: vi.fn().mockImplementation(() => ({
      extend: vi.fn(),
      isEmpty: vi.fn().mockReturnValue(true),
    })),
  },
}))

// Stub import.meta.env for tests
Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_API_BASE_URL: 'http://localhost:8000',
    VITE_MAP_STYLE: 'https://tiles.openfreemap.org/styles/liberty',
    VITE_MAP_INITIAL_LNG: '-97.9',
    VITE_MAP_INITIAL_LAT: '30.05',
    VITE_MAP_INITIAL_ZOOM: '10',
  },
  writable: true,
})
