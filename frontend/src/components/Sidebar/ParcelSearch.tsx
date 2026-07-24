import { useParcels } from '../../hooks/useParcels'
import { useDebounce } from '../../hooks/useDebounce'
import { useStore } from '../../state/store'

/** Result rows fetched per query. The backend caps `limit` at 1000. */
const RESULT_LIMIT = 50

export function ParcelSearch() {
  const { parcelSearch, setParcelSearch, setSelectedParcel, selectedParcelId } = useStore()

  // Typing hits the server, so debounce rather than firing per keystroke.
  const debouncedSearch = useDebounce(parcelSearch, 250)

  const { data, isLoading, isFetching, isError } = useParcels({
    q: debouncedSearch.trim() || undefined,
    limit: RESULT_LIMIT,
  })

  const results = data?.parcels ?? []
  const totalMatches = data?.total_count ?? 0
  const truncated = totalMatches > results.length

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        Select Parcel
      </h2>

      <input
        type="text"
        placeholder="Search by ID, owner, or address…"
        value={parcelSearch}
        onChange={(e) => setParcelSearch(e.target.value)}
        className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
      />

      {isLoading && <p className="text-xs text-gray-400">Loading parcels…</p>}
      {isError && (
        <p className="text-xs text-red-500">Failed to load parcels — is the backend running?</p>
      )}

      {!isLoading && !isError && data && (
        <p className="text-xs text-gray-400 mb-1 flex items-center gap-1.5">
          <span>
            {debouncedSearch.trim()
              ? `${totalMatches.toLocaleString()} match${totalMatches === 1 ? '' : 'es'}`
              : `${totalMatches.toLocaleString()} parcels`}
            {truncated && ` · showing first ${results.length}`}
          </span>
          {isFetching && (
            <span className="inline-block w-2 h-2 border border-blue-400 border-t-transparent rounded-full animate-spin" />
          )}
        </p>
      )}

      <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200 divide-y divide-gray-100 text-sm">
        {results.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedParcel(p)}
            className={`w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors ${
              selectedParcelId === p.id ? 'bg-blue-100 font-medium text-blue-800' : 'text-gray-700'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-xs truncate">{p.id}</span>
              <span className="text-gray-400 shrink-0">{p.area_acres.toFixed(1)} ac</span>
            </div>
            {typeof p.attributes?.OWNER_NAME === 'string' && (
              <span className="block text-[10px] text-gray-400 truncate">
                {p.attributes.OWNER_NAME}
              </span>
            )}
          </button>
        ))}
        {results.length === 0 && !isLoading && (
          <p className="text-xs text-gray-400 px-3 py-2">No parcels match</p>
        )}
      </div>

      {truncated && (
        <p className="mt-1 text-[10px] text-gray-400">
          Refine the search to narrow these results.
        </p>
      )}

      {selectedParcelId && (
        <p className="mt-2 text-xs text-blue-600 font-medium">✓ Selected: {selectedParcelId}</p>
      )}
      <p className="mt-1 text-xs text-gray-400">Or click a parcel directly on the map.</p>
    </div>
  )
}
