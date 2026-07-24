import { useStore } from '../../state/store'
import { ParcelSearch } from './ParcelSearch'
import { BufferSliders } from './BufferSliders'
import { BreakdownTable } from './BreakdownTable'
import { LayerToggles } from './LayerToggles'
import { DrawTools } from './DrawTools'

interface SidebarProps {
  /** Below `lg`, the sidebar is an off-canvas drawer; this controls whether it's shown. */
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { reset, selectedParcelId } = useStore()

  return (
    <aside
      className={`fixed inset-y-0 right-0 z-30 w-80 max-w-[85vw] h-full bg-white border-l border-gray-200 flex flex-col overflow-hidden shadow-lg transition-transform duration-300 ease-in-out
        lg:static lg:z-auto lg:translate-x-0
        ${open ? 'translate-x-0' : 'translate-x-full'}`}
    >
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-200 flex-shrink-0 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-base font-bold text-gray-900">Buildable Land Analysis</h1>
          <p className="text-xs text-gray-500 mt-0.5">Hays County, TX · EPSG:32614</p>
        </div>
        <button
          onClick={onClose}
          className="lg:hidden flex-shrink-0 text-gray-400 hover:text-gray-600 p-1 -mr-1 -mt-1"
          aria-label="Close panel"
        >
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 divide-y divide-gray-100">
        <div className="pb-4">
          <ParcelSearch />
        </div>

        <div className="pt-4 pb-4">
          <BufferSliders />
        </div>

        <div className="pt-4 pb-4">
          <DrawTools />
        </div>

        <div className="pt-4 pb-4">
          <BreakdownTable />
        </div>

        <div className="pt-4 pb-4">
          <LayerToggles />
        </div>
      </div>

      {/* Footer / Reset */}
      <div className="px-4 py-3 border-t border-gray-200 flex-shrink-0">
        <button
          onClick={reset}
          disabled={!selectedParcelId}
          className="w-full flex items-center justify-center gap-1.5 text-sm font-medium py-2 px-4 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 10a6 6 0 1 1 1.76 4.24" strokeLinecap="round" />
            <path d="M4 14v-4h4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Reset buffers &amp; drawings
        </button>
        <p className="text-[10px] text-gray-400 text-center mt-1">
          Resets sliders to defaults and clears drawn shapes
        </p>
      </div>
    </aside>
  )
}
