import { useStore } from '../../state/store'
import type { DrawMode } from '../../types/api'

export function DrawTools() {
  const drawMode = useStore((s) => s.drawMode)
  const drawnShapes = useStore((s) => s.drawnShapes)
  const setDrawMode = useStore((s) => s.setDrawMode)
  const removeDrawnShape = useStore((s) => s.removeDrawnShape)
  const clearDrawnShapes = useStore((s) => s.clearDrawnShapes)
  const selectedParcelId = useStore((s) => s.selectedParcelId)

  const activate = (mode: DrawMode) => {
    setDrawMode(drawMode === mode ? null : mode)
  }

  const carveOuts = drawnShapes.filter((s) => s.mode === 'carve_out')
  const restores = drawnShapes.filter((s) => s.mode === 'restore')

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        Draw Tools
      </h2>

      {!selectedParcelId && (
        <p className="text-xs text-gray-400 mb-2">Select a parcel first.</p>
      )}

      <div className="flex gap-2 mb-3">
        <button
          onClick={() => activate('carve_out')}
          disabled={!selectedParcelId}
          className={`flex-1 text-xs font-medium py-2 px-3 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            drawMode === 'carve_out'
              ? 'bg-red-600 text-white border-red-700'
              : 'bg-white text-red-700 border-red-300 hover:bg-red-50'
          }`}
        >
          ✂ Exclude area
        </button>
        <button
          onClick={() => activate('restore')}
          disabled={!selectedParcelId}
          className={`flex-1 text-xs font-medium py-2 px-3 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            drawMode === 'restore'
              ? 'bg-green-600 text-white border-green-700'
              : 'bg-white text-green-700 border-green-300 hover:bg-green-50'
          }`}
        >
          ↩ Restore area
        </button>
      </div>

      {drawMode && (
        <p className="text-[10px] text-orange-600 bg-orange-50 rounded px-2 py-1 mb-2">
          Click to add vertices · Close by clicking the first point, or press Enter · Esc to cancel
        </p>
      )}

      {drawnShapes.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-gray-500">
              {carveOuts.length} exclusion{carveOuts.length !== 1 ? 's' : ''} · {restores.length} restore{restores.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={clearDrawnShapes}
              className="text-[10px] text-gray-400 hover:text-red-500 transition-colors"
            >
              Clear all
            </button>
          </div>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {drawnShapes.map((sh) => (
              <li key={sh.id} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1">
                <span className={sh.mode === 'carve_out' ? 'text-red-600' : 'text-green-600'}>
                  {sh.mode === 'carve_out' ? '✂' : '↩'} {sh.id}
                </span>
                <button
                  onClick={() => removeDrawnShape(sh.id)}
                  className="text-gray-400 hover:text-red-500 ml-2"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
