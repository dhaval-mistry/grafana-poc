import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiGet, apiPostForm, apiPostJson } from './apiClient'
import { completeJourney, failJourney, initializeTelemetry, setJourneyStage, startAuthenticatedSession, startJourney } from '../observability/telemetry'

vi.mock('../config', () => ({ config: { apiBaseUrl: 'http://localhost:8000' } }))
// No networking in unit tests; keep real context generation and the OTel SDK.
vi.mock('@opentelemetry/exporter-trace-otlp-http', async () => {
  const { InMemorySpanExporter } = await import('@opentelemetry/sdk-trace-base')
  return { OTLPTraceExporter: InMemorySpanExporter }
})
vi.mock('@opentelemetry/exporter-logs-otlp-http', async () => {
  const { InMemoryLogRecordExporter } = await import('@opentelemetry/sdk-logs')
  return { OTLPLogExporter: InMemoryLogRecordExporter }
})
vi.mock('@opentelemetry/exporter-metrics-otlp-http', async () => {
  const { InMemoryMetricExporter, AggregationTemporality } = await import('@opentelemetry/sdk-metrics')
  return { OTLPMetricExporter: class extends InMemoryMetricExporter { constructor() { super(AggregationTemporality.CUMULATIVE) } } }
})
const storage = new Map<string, string>()
const fetchMock = vi.fn<typeof fetch>()
beforeAll(() => {
  vi.stubEnv('VITE_OTEL_ENABLED', 'true')
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  initializeTelemetry()
})
beforeEach(() => { storage.clear(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })

describe('shared banking client context', () => {
  it('keeps login unauthenticated and independent of transfer correlation', async () => {
    const journey = startJourney('login')
    fetchMock.mockResolvedValue(new Response('{"access_token":"test-response-token"}', { status: 200 }))
    const data = await apiPostForm<{ access_token: string }>('http://localhost:8000/api/v1/auth/token',
      new URLSearchParams({ username: 'test-user', password: 'test-password' }), journey)
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['X-Correlation-ID']).toBe(journey.correlationId)
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    expect(data.access_token).toBe('test-response-token')
    completeJourney(journey)
  })
  it('keeps lookup/payment/retry IDs and idempotency semantics unchanged', async () => {
    storage.set('happy-wallet-token', 'test-jwt')
    const session = startAuthenticatedSession()
    const journey = startJourney('transfer')
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    setJourneyStage(journey, 'recipient_verify')
    await apiPostJson('http://localhost:8000/api/v1/accounts/lookup', { account_number: 'private-test-account' }, {}, journey)
    fetchMock.mockRejectedValueOnce(new Error('raw network exception must not be exported'))
    setJourneyStage(journey, 'submit')
    await expect(apiPostJson('http://localhost:8000/api/v1/payments', { amount: '1' }, { 'Idempotency-Key': 'same-test-key' }, journey)).rejects.toMatchObject({ status: 0 })
    failJourney(journey, 'network', true)
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 201 }))
    await apiPostJson('http://localhost:8000/api/v1/payments', { amount: '1' }, { 'Idempotency-Key': 'same-test-key' }, journey)
    const headers = fetchMock.mock.calls.map(call => call[1]?.headers as Record<string, string>)
    expect(headers.every(h => h['X-Correlation-ID'] === journey.correlationId && h['X-Session-ID'] === session)).toBe(true)
    expect(headers[1]['Idempotency-Key']).toBe(headers[2]['Idempotency-Key'])
    expect(headers[1].Authorization).toBe('Bearer test-jwt')
    expect(new Set(headers.map(h => h.traceparent)).size).toBe(3)
    completeJourney(journey)
  })
  it('preserves auth/error contracts and never relies on the observability session for auth', async () => {
    startAuthenticatedSession()
    await expect(apiGet('http://localhost:8000/api/v1/accounts')).rejects.toMatchObject({ status: 401, message: 'Your login session is not available.' })
    expect(fetchMock).not.toHaveBeenCalled()
    storage.set('happy-wallet-token', 'test-jwt')
    fetchMock.mockResolvedValue(new Response('private-body-must-not-be-read', { status: 409 }))
    await expect(apiPostJson('http://localhost:8000/api/v1/payments', {})).rejects.toEqual(new ApiError(409, 'Banking API returned 409.'))
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(apiGet('http://localhost:8000/api/v1/accounts')).resolves.toBeUndefined()
    fetchMock.mockResolvedValue(new Response('not-json', { status: 200 }))
    await expect(apiGet('http://localhost:8000/api/v1/accounts')).rejects.toMatchObject({ message: 'The banking API returned an invalid response.' })
  })
  it('does not attach observability context to unknown or external endpoints', async () => {
    storage.set('happy-wallet-token', 'test-jwt')
    fetchMock.mockResolvedValue(new Response('{}'))
    await apiGet('https://other.example/api/v1/accounts')
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['X-Correlation-ID']).toBeUndefined()
    expect(headers.traceparent).toBeUndefined()
  })
})
