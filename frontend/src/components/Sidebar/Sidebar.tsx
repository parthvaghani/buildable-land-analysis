import { useStore } from '../../state/store'
import { ParcelSearch } from './ParcelSearch'
import { BufferSliders } from './BufferSliders'
import { BreakdownTable } from './BreakdownTable'
import { LayerToggles } from './LayerToggles'
import { DrawTools } from './DrawTools'

export function Sidebar() {
  const { reset, selectedParcelId } = useStore()

  return (
    <aside className="w-80 h-full bg-white border-l border-gray-200 flex flex-col overflow-hidden shadow-lg">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-200 flex-shrink-0">
        <h1 className="text-base font-bold text-gray-900">Buildable Land Analysis</h1>
        <p className="text-xs text-gray-500 mt-0.5">Hays County, TX · EPSG:32614</p>
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
          className="w-full text-sm font-medium py-2 px-4 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ↺ Reset buffers &amp; drawings
        </button>
        <p className="text-[10px] text-gray-400 text-center mt-1">
          Resets sliders to defaults and clears drawn shapes
        </p>
      </div>
    </aside>
  )
}
