import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fetchConfig } from '../api/client'
import { useStore } from '../state/store'

export function useConfig() {
  const setDefaultBuffers = useStore((s) => s.setDefaultBuffers)

  const query = useQuery({
    queryKey: ['config'],
    queryFn: fetchConfig,
    staleTime: Infinity, // config doesn't change at runtime
  })

  // Seed the store with backend defaults on first load.
  useEffect(() => {
    if (query.data) setDefaultBuffers(query.data)
  }, [query.data, setDefaultBuffers])

  return query
}
