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

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Map takes all remaining space */}
      <div className="flex-1 relative">
        <MapView />
      </div>

      {/* Sidebar is fixed width on the right */}
      <Sidebar />
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
