import { useEffect, useRef, useState } from 'react'

/**
 * Rate-limited mirror of `value`: emits immediately, then at most once per
 * `intervalMs` for as long as the value keeps changing, always finishing on the
 * latest value.
 *
 * Differs from useDebounce, which emits only once changes stop — that reads as
 * "nothing happens until I let go" when driving a map from a slider drag.
 */
export function useThrottle<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState<T>(value)
  const lastEmitRef = useRef(0)
  const latestRef = useRef(value)

  useEffect(() => {
    latestRef.current = value
    const elapsed = Date.now() - lastEmitRef.current

    // Leading edge: first move of a gesture lands with no perceptible lag.
    if (elapsed >= intervalMs) {
      lastEmitRef.current = Date.now()
      setThrottled(value)
      return
    }

    // Trailing edge: guarantees the value the user actually settled on is
    // emitted, even if the drag ends inside a throttle window.
    const timer = setTimeout(() => {
      lastEmitRef.current = Date.now()
      setThrottled(latestRef.current)
    }, intervalMs - elapsed)

    return () => clearTimeout(timer)
  }, [value, intervalMs])

  return throttled
}
