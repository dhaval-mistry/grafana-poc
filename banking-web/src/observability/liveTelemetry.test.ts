import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiPostForm, apiPostJson } from '../api/apiClient'
import { captureJavaScriptError, failJourney, flushTelemetry, initializeTelemetry,
  recipientVerificationFailed, setJourneyStage, startAuthenticatedSession, startJourney } from './telemetry'

vi.mock('../config', () => ({ config: { apiBaseUrl: 'http://localhost:8000' } }))

// Opt-in integration check: real SDK exporters -> Vite -> Alloy -> storage.
// Synthetic invalid authentication prevents banking writes or customer lookup.
describe.skipIf(import.meta.env.VITE_OTEL_LIVE_TEST !== 'true')('local OTLP integration', () => {
  it('propagates frontend trace/correlation and exports safe logs/metrics/errors', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    vi.stubGlobal('location', { href: 'http://localhost:5173/', origin: 'http://localhost:5173' })
    vi.stubEnv('VITE_OTEL_ENABLED', 'true')
    initializeTelemetry()
    const responses: { sent: string; received: string | null; parent: string }[] = []
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
      const response = await realFetch(input, options)
      if (String(input).startsWith('http://localhost:8000')) {
        const headers = options?.headers as Record<string, string>
        responses.push({ sent: headers['X-Correlation-ID'], received: response.headers.get('X-Correlation-ID'), parent: headers.traceparent })
      }
      return response
    })
    const login = startJourney('login')
    await expect(apiPostForm('http://localhost:8000/api/v1/auth/token', new URLSearchParams(), login)).rejects.toBeInstanceOf(ApiError)
    failJourney(login, 'validation')
    startAuthenticatedSession()
    values.set('happy-wallet-token', 'synthetic-invalid-token-for-no-write-check')
    const transfer = startJourney('transfer')
    setJourneyStage(transfer, 'recipient_verify')
    await expect(apiPostJson('http://localhost:8000/api/v1/accounts/lookup', {}, {}, transfer)).rejects.toMatchObject({ status: 401 })
    recipientVerificationFailed(transfer, 'authentication')
    setJourneyStage(transfer, 'review')
    setJourneyStage(transfer, 'submit')
    await expect(apiPostJson('http://localhost:8000/api/v1/payments', {}, {}, transfer)).rejects.toMatchObject({ status: 401 })
    failJourney(transfer, 'authentication')
    captureJavaScriptError('error')
    await flushTelemetry()
    expect(responses).toHaveLength(3)
    expect(responses.every(r => r.sent === r.received)).toBe(true)
    expect(responses[0].sent).not.toBe(responses[1].sent)
    expect(responses[1].sent).toBe(responses[2].sent)

    const traceId = transfer.span.spanContext().traceId
    const loadTrace = async (): Promise<Record<string, unknown> | undefined> => {
      const response = await realFetch(`http://localhost:3200/api/traces/${traceId}`)
      return response.ok ? await response.json() : undefined
    }
    let traceData: Record<string, unknown> | undefined
    for (let i = 0; i < 40; i++) {
      traceData = await loadTrace()
      const encoded = JSON.stringify(traceData ?? {})
      if (encoded.includes('happy-wallet-web') && encoded.includes('synthetic-banking-api')) break
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    expect(traceData).toBeDefined()
    const encoded = JSON.stringify(traceData)
    expect(encoded).toContain('happy-wallet-web')
    expect(encoded).toContain('synthetic-banking-api')
    expect(encoded).toContain(transfer.correlationId)
    expect(encoded).not.toContain('synthetic-invalid-token-for-no-write-check')
    // Verify backend server spans are direct children of the propagated CLIENT
    // span IDs, not merely separate traces carrying the same correlation ID.
    const data = traceData as { batches: { scopeSpans: { spans: { kind: string | number; parentSpanId: string; traceId: string }[] }[] }[] }
    const spans = data.batches.flatMap(b => b.scopeSpans.flatMap(s => s.spans))
    // Tempo's OTLP JSON represents byte fields as base64; traceparent uses hex.
    const spanIdHex = (value: string | undefined) => value
      ? (/^[0-9a-f]{16}$/i.test(value) ? value : Array.from(atob(value), c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''))
      : undefined
    for (const response of responses.slice(1)) {
      const clientId = response.parent.split('-')[2]
      expect(spans.some(s => (s.kind === 'SPAN_KIND_SERVER' || s.kind === 2) && spanIdHex(s.parentSpanId) === clientId),
        JSON.stringify({ clientId, spans: spans.map(s => ({ kind: s.kind, parentSpanId: s.parentSpanId })) })).toBe(true)
    }
    const logQuery = `{service_name="happy-wallet-web"} | correlation_id = "${transfer.correlationId}"`
    const logResponse = await realFetch('http://localhost:3100/loki/api/v1/query_range?' + new URLSearchParams({ query: logQuery, limit: '100', since: '15m' }))
    expect(logResponse.ok).toBe(true)
    const logData = await logResponse.json()
    expect(JSON.stringify(logData)).toContain('journey_failed')
    expect(JSON.stringify(logData)).toContain(traceId)
    const metricResponse = await realFetch('http://localhost:9090/api/v1/query?' + new URLSearchParams({ query: 'banking_web_journey_events_total' }))
    expect(metricResponse.ok).toBe(true)
    const metricData = await metricResponse.json()
    expect(metricData.data.result.length).toBeGreaterThan(0)
    for (const row of metricData.data.result) {
      expect(Object.keys(row.metric).join(',')).not.toMatch(/correlation_id|trace_id|session_id|account_id|customer_id|payment_id/)
    }
    console.info(`Live frontend/backend trace verified: correlation=${transfer.correlationId} trace=${traceId}`)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }, 60000)
})
