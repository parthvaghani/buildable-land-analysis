import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Joyride } from 'react-joyride'
import { MapView } from './components/Map/MapView'
import { Sidebar } from './components/Sidebar/Sidebar'
import { useConfig } from './hooks/useConfig'
import { useOnboardingTour } from './hooks/useOnboardingTour'
import { useStore } from './state/store'

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
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const setSidebarOpen = useStore((s) => s.setSidebarOpen)

  const { run: tourRun, steps: tourSteps, handleEvent: handleTourEvent, startTour } =
    useOnboardingTour()

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Joyride
        run={tourRun}
        steps={tourSteps}
        continuous
        onEvent={handleTourEvent}
        options={{
          primaryColor: '#0F766E',
          skipBeacon: true,
          showProgress: true,
          zIndex: 100,
        }}
        styles={{
          tooltip: { width: 280, maxWidth: '85vw', fontSize: 13 },
          tooltipTitle: { fontSize: 14 },
          tooltipContent: { padding: '8px 0', fontSize: 13, lineHeight: 1.5 },
          tooltipFooter: { fontSize: 12, marginTop: 12 },
          buttonPrimary: { fontSize: 13 },
          buttonBack: { fontSize: 13 },
          buttonSkip: { fontSize: 13 },
        }}
      />

      {/* Map takes all remaining space */}
      <div className="flex-1 relative">
        <MapView />

        {/* Top-left utility cluster: hamburger (mobile only) + help, in that
            order so they read left-to-right without jumping around when the
            hamburger disappears at `lg`. */}
        <div className="absolute top-3 left-3 z-10 flex gap-2">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden bg-white shadow-md rounded-full p-2.5 text-gray-700 hover:bg-gray-50 transition-colors"
              aria-label="Open panel"
            >
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
              </svg>
            </button>
          )}

          <button
            onClick={startTour}
            className="bg-white shadow-md rounded-full p-2.5 text-gray-700 hover:bg-gray-50 transition-colors"
            aria-label="Show app guide"
            title="Show app guide"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="10" cy="10" r="7.5" />
              <path d="M7.8 7.8a2.2 2.2 0 1 1 3.1 2c-.7.5-1.4 1-1.4 2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="10" cy="14" r="0.75" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
      </div>

      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/30 z-20"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

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
