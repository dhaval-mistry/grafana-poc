import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initializeTelemetry, installErrorCapture, flushTelemetry } from './observability/telemetry'

initializeTelemetry()
const removeErrorCapture = installErrorCapture()
const flushWhenHidden = () => {
  if (document.visibilityState === 'hidden') void flushTelemetry()
}
document.addEventListener('visibilitychange', flushWhenHidden)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    removeErrorCapture()
    document.removeEventListener('visibilitychange', flushWhenHidden)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
