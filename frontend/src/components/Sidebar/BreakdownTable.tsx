/**
 * Breakdown table — shows per-constraint acres removed.
 *
 * The spec requires the UI to make the "totals add up" requirement
 * checkable by eye: we render an explicit sum row and flag any
 * floating-point discrepancy visually.
 */

import { useCompute } from '../../hooks/useCompute'

const TYPE_COLORS: Record<string, string> = {
  wetland:        'bg-cyan-100 text-cyan-800',
  floodplain:     'bg-blue-100 text-blue-800',
  easement:       'bg-amber-100 text-amber-800',
  building:       'bg-violet-100 text-violet-800',
  user_carve_out: 'bg-red-100 text-red-800',
}

export function BreakdownTable() {
  const { data, isLoading, isError, isFetching } = useCompute()

  if (!data && !isLoading && !isError) {
    return (
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Area Breakdown
        </h2>
        <p className="text-xs text-gray-400">Select a parcel to see the breakdown.</p>
      </div>
    )
  }

  const totalRemoved = data ? +(data.total_parcel_acres - data.buildable_acres).toFixed(2) : 0
  const breakdownSum = data
    ? +data.breakdown.reduce((s, r) => s + r.acres_removed, 0).toFixed(2)
    : 0
  const sumMismatch = data ? Math.abs(breakdownSum - totalRemoved) > 0.05 : false

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Area Breakdown
        </h2>
        {isFetching && (
          <span className="text-[10px] text-brand flex items-center gap-1">
            <span className="inline-block w-2 h-2 border border-brand border-t-transparent rounded-full animate-spin" />
            updating
          </span>
        )}
      </div>

      {isError && (
        <p className="text-xs text-red-500">Computation failed — check backend connection.</p>
      )}

      {data && (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-gray-50 rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Total parcel</p>
              <p className="text-lg font-bold text-gray-800">{data.total_parcel_acres.toFixed(2)}</p>
              <p className="text-[10px] text-gray-500">acres</p>
            </div>
            <div className="bg-green-50 rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-green-600 uppercase tracking-wide">Buildable</p>
              <p className="text-lg font-bold text-green-700">{data.buildable_acres.toFixed(2)}</p>
              <p className="text-[10px] text-green-600">acres</p>
            </div>
          </div>

          {/* Breakdown rows */}
          {data.breakdown.length > 0 ? (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-1 text-gray-500 font-medium">Constraint</th>
                  <th className="text-right py-1 text-gray-500 font-medium">Removed (ac)</th>
                  <th className="text-right py-1 text-gray-500 font-medium">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.breakdown.map((row) => (
                  <tr key={row.type} title={row.source}>
                    <td className="py-1.5 pr-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${TYPE_COLORS[row.type] ?? 'bg-gray-100 text-gray-700'}`}>
                        {row.type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="text-right py-1.5 font-mono text-gray-700">
                      {row.acres_removed.toFixed(2)}
                    </td>
                    <td className="text-right py-1.5 text-gray-500">
                      {data.total_parcel_acres > 0
                        ? ((row.acres_removed / data.total_parcel_acres) * 100).toFixed(1)
                        : '0.0'}%
                    </td>
                  </tr>
                ))}

                {/* Sum row — the "totals add up" visual check */}
                <tr className={`border-t-2 font-semibold ${sumMismatch ? 'border-red-400 text-red-600' : 'border-gray-300 text-gray-800'}`}>
                  <td className="pt-1.5">Total removed</td>
                  <td className="text-right pt-1.5 font-mono">{totalRemoved.toFixed(2)}</td>
                  <td className="text-right pt-1.5">
                    {data.total_parcel_acres > 0
                      ? ((totalRemoved / data.total_parcel_acres) * 100).toFixed(1)
                      : '0.0'}%
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-gray-400">No constraints intersect this parcel.</p>
          )}

          {sumMismatch && (
            <p className="mt-1 text-[10px] text-red-500 flex items-start gap-1">
              <svg className="w-3 h-3 flex-shrink-0 mt-px" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 3l8 14H2l8-14z" strokeLinejoin="round" />
                <path d="M10 8v3.5" strokeLinecap="round" />
                <circle cx="10" cy="14.5" r="0.75" fill="currentColor" stroke="none" />
              </svg>
              Breakdown sum ({breakdownSum.toFixed(2)}) ≠ total removed ({totalRemoved.toFixed(2)}) — backend data issue.
            </p>
          )}
        </>
      )}
    </div>
  )
}
