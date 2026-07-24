import { useStore } from '../../state/store'
import type { BufferConfig } from '../../types/api'

const SLIDER_CONFIG: {
  key: keyof BufferConfig
  label: string
  min: number
  max: number
  step: number
  colorHex: string
}[] = [
  { key: 'wetland_ft',    label: 'Wetland setback',   min: 0, max: 500, step: 5,  colorHex: '#06b6d4' },
  { key: 'floodplain_ft', label: 'Floodplain buffer', min: 0, max: 200, step: 5,  colorHex: '#3b82f6' },
  { key: 'easement_ft',   label: 'Easement corridor', min: 0, max: 500, step: 10, colorHex: '#f59e0b' },
  { key: 'building_ft',   label: 'Building setback',  min: 0, max: 200, step: 5,  colorHex: '#8b5cf6' },
]

export function BufferSliders() {
  const buffers = useStore((s) => s.buffers)
  const setBuffer = useStore((s) => s.setBuffer)
  const selectedParcelId = useStore((s) => s.selectedParcelId)

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
        Setback Distances
      </h2>

      {!selectedParcelId && (
        <p className="text-xs text-gray-400 mb-2">Select a parcel to see live results.</p>
      )}

      <div className="space-y-4">
        {SLIDER_CONFIG.map(({ key, label, min, max, step, colorHex }) => {
          const value = buffers[key]
          const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))

          return (
            <div key={key}>
              <div className="flex justify-between items-baseline mb-1">
                <label className="text-xs font-medium text-gray-700">{label}</label>
                <span className="text-xs font-mono text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                  {value} ft
                </span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => setBuffer(key, Number(e.target.value))}
                className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gray-200"
                style={{
                  background: `linear-gradient(to right, ${colorHex} 0%, ${colorHex} ${pct}%, #e5e7eb ${pct}%, #e5e7eb 100%)`,
                  ['--thumb-color' as string]: colorHex,
                }}
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                <span>{min} ft</span>
                <span>{max} ft</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
