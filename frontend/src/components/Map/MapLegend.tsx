import { useStore } from '../../state/store'
import { LAYERS } from '../../constants/layerLegend'

/**
 * Compact on-map legend — the sidebar's LayerToggles can be hidden (off-canvas
 * drawer below `lg`), so the map itself needs to explain what its colors mean
 * without depending on the sidebar being open.
 */
export function MapLegend() {
  const layerVisibility = useStore((s) => s.layerVisibility)
  const selectedParcelId = useStore((s) => s.selectedParcelId)

  const visible = LAYERS.filter(({ key }) => {
    if (!layerVisibility[key]) return false
    // Buildable/excluded only render once a parcel is selected and computed —
    // listing them beforehand would describe colors that aren't on screen.
    if (key === 'buildable' || key === 'excluded') return Boolean(selectedParcelId)
    return true
  })

  if (visible.length === 0) return null

  return (
    <div className="bg-white/90 rounded-md shadow-md px-3 py-2 pointer-events-none max-w-[180px]">
      <ul className="space-y-1">
        {visible.map(({ key, label, color }) => (
          <li key={key} className="flex items-center gap-1.5 text-[11px] text-gray-700">
            <span
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="truncate">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
