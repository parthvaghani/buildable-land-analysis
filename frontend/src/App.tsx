import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MapView } from './components/Map/MapView'
import { Sidebar } from './components/Sidebar/Sidebar'
import { useConfig } from './hooks/useConfig'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function AppInner() {
  // Load backend config defaults and seed the buffer sliders on startup.
  useConfig()

  // Below `lg`, the sidebar becomes an off-canvas drawer instead of a static
  // column — a fixed 320px column would otherwise eat most of a phone-width
  // viewport and leave almost no room for the map.
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Map takes all remaining space */}
      <div className="flex-1 relative">
        <MapView />

        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden absolute top-3 left-3 z-10 bg-white shadow-md rounded-full p-2.5 text-gray-700 hover:bg-gray-50 transition-colors"
            aria-label="Open panel"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/30 z-20"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    </div>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  )
}
