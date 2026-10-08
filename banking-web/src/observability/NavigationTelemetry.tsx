import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { recordNavigation } from './telemetry'

let lastNavigationKey: string | undefined

export default function NavigationTelemetry() {
  const location = useLocation()
  useEffect(() => {
    // Measure route commit to the next painted frame, not data-load completion.
    // Ignore search/hash entirely and deduplicate StrictMode's repeated effects.
    if (lastNavigationKey === location.key) return
    const started = performance.now()
    const frame = requestAnimationFrame(() => {
      lastNavigationKey = location.key
      recordNavigation(location.pathname, performance.now() - started)
    })
    return () => cancelAnimationFrame(frame)
  }, [location.key, location.pathname])
  return null
}
