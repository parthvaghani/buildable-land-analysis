import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchParcels } from '../api/client'

export interface UseParcelsParams {
  bbox?: string
  q?: string
  limit?: number
  offset?: number
  /** Skip the request entirely — used to wait for the map's first viewport. */
  enabled?: boolean
}

export function useParcels(params: UseParcelsParams = {}) {
  const { enabled = true, ...query } = params

  return useQuery({
    queryKey: ['parcels', query],
    queryFn: () => fetchParcels(query),
    enabled,
    staleTime: 5 * 60 * 1000,
    // Panning and typing both change the key continuously; holding the previous
    // page stops the map and the result list emptying between responses.
    placeholderData: keepPreviousData,
  })
}
