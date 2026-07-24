import { useQuery } from '@tanstack/react-query'
import { fetchConstraints } from '../../api/client'
import { useStore } from '../../state/store'
import { LAYERS } from '../../constants/layerLegend'

export function LayerToggles() {
  const layerVisibility = useStore((s) => s.layerVisibility)
  const toggleLayer = useStore((s) => s.toggleLayer)

  // Constraint layers are configured in config.yaml but only render if their
  // ingest actually produced data, so mark the empty ones rather than offering a
  // toggle that appears broken.
  const { data: constraints } = useQuery({
    queryKey: ['constraints'],
    queryFn: fetchConstraints,
    staleTime: Infinity,
  })

  const emptyLayers = new Set(
    constraints?.layers.filter((l) => l.feature_count === 0).map((l) => l.name) ?? [],
  )

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        Map Layers
      </h2>
      <div className="space-y-1.5">
        {LAYERS.map(({ key, label, color, description }) => {
          const noData = emptyLayers.has(key)
          return (
            <label
              key={key}
              title={noData ? `${description} — no data ingested for this layer` : description}
              className={`flex items-center gap-2.5 group ${
                noData ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              }`}
            >
              <div className="relative flex-shrink-0">
                <input
                  type="checkbox"
                  checked={layerVisibility[key] && !noData}
                  disabled={noData}
                  onChange={() => toggleLayer(key)}
                  className="sr-only peer"
                />
                <div className="w-8 h-4 bg-gray-200 rounded-full peer peer-checked:bg-brand transition-colors" />
                <div className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
              </div>
              <span
                className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-gray-700 group-hover:text-gray-900">{label}</span>
              {noData && <span className="text-[10px] text-gray-400 ml-auto">no data</span>}
            </label>
          )
        })}
      </div>
    </div>
  )
}
