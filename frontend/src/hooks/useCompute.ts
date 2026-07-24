/**
 * Core compute hook.
 *
 * Buffer slider changes are throttled rather than debounced, so the map keeps
 * redrawing *during* a drag instead of only once the user lets go, while still
 * capping how many requests a fast drag can issue.  Draw events (carveOuts /
 * restores arrays changing) are not rate-limited at all — they fire immediately
 * because draw-complete is a discrete user action (per Milestone 2 spec, 6.4).
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { compute, fetchConstraintFeatures } from '../api/client'
import { selectCarveOuts, selectRestores, useStore } from '../state/store'
import { useThrottle } from './useThrottle'

/** Roughly 8 updates/sec — reads as continuous without saturating the backend. */
const BUFFER_UPDATE_INTERVAL_MS = 120

export function useCompute() {
  const selectedParcelId = useStore((s) => s.selectedParcelId)
  const buffers = useStore((s) => s.buffers)
  const carveOuts = useStore(selectCarveOuts)
  const restores = useStore(selectRestores)

  // Throttle buffer values only — draw changes fire immediately.
  const throttledBuffers = useThrottle(buffers, BUFFER_UPDATE_INTERVAL_MS)

  return useQuery({
    queryKey: ['compute', selectedParcelId, throttledBuffers, carveOuts, restores],
    queryFn: () =>
      compute({
        parcel_id: selectedParcelId!,
        buffers: throttledBuffers,
        carve_outs: carveOuts,
        restores,
      }),
    enabled: !!selectedParcelId,
    staleTime: 0,
    retry: 1,
    // Hold the last result while the next one is in flight.  Without this the
    // buildable polygon unmounts between requests and the map strobes as you drag.
    placeholderData: keepPreviousData,
  })
}

export function useConstraintFeatures() {
  const selectedParcelId = useStore((s) => s.selectedParcelId)

  return useQuery({
    queryKey: ['constraint-features', selectedParcelId],
    queryFn: () => fetchConstraintFeatures(selectedParcelId!),
    enabled: !!selectedParcelId,
    staleTime: 60_000,
  })
}
