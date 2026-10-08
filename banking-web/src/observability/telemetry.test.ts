import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Actual SDK processors/providers, in-memory exporters: inspect exactly what the
// OTLP exporters would receive, including span parenting and metric attributes.
const exporters = await vi.hoisted(async () => {
  const { InMemorySpanExporter } = await import('@opentelemetry/sdk-trace-base')
  const { InMemoryLogRecordExporter } = await import('@opentelemetry/sdk-logs')
  const { InMemoryMetricExporter, AggregationTemporality } = await import('@opentelemetry/sdk-metrics')
  return {
    spans: new InMemorySpanExporter(), logs: new InMemoryLogRecordExporter(),
    metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
  }
})
vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({ OTLPTraceExporter: class { constructor() { return exporters.spans } } }))
vi.mock('@opentelemetry/exporter-logs-otlp-http', () => ({ OTLPLogExporter: class { constructor() { return exporters.logs } } }))
vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({ OTLPMetricExporter: class { constructor() { return exporters.metrics } } }))

import {
  cancelJourney, captureJavaScriptError, clearObservabilitySession, completeJourney,
  failJourney, failureForStatus, flushTelemetry, getObservabilitySessionId,
  initializeTelemetry, installErrorCapture, recipientVerificationFailed,
  recordNavigation, restoreAuthenticatedSession, safeApiRoute, setJourneyStage,
  startApiTelemetry, startAuthenticatedSession, startJourney,
} from './telemetry'

const storage = new Map<string, string>()
beforeAll(() => {
  vi.stubEnv('VITE_OTEL_ENABLED', 'true')
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  initializeTelemetry()
})
beforeEach(() => { clearObservabilitySession(); exporters.spans.reset(); exporters.logs.reset() })
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('observability session lifecycle', () => {
  it('restores one opaque session, rotates after login, and clears independently of auth', () => {
    expect(getObservabilitySessionId()).toBeUndefined()
    storage.set('happy-wallet-token', 'test-token-never-observed')
    const first = startAuthenticatedSession()
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    restoreAuthenticatedSession(true)
    expect(getObservabilitySessionId()).toBe(first)
    expect(startAuthenticatedSession()).not.toBe(first)
    restoreAuthenticatedSession(false)
    expect(getObservabilitySessionId()).toBeUndefined()
    expect(storage.get('happy-wallet-token')).toBe('test-token-never-observed')
  })
  it('replaces invalid stored IDs without ever using their content', () => {
    storage.set('happy-wallet-observability-session', 'sensitive-arbitrary-value')
    restoreAuthenticatedSession(true)
    expect(getObservabilitySessionId()).toMatch(/^[0-9a-f-]{36}$/)
  })
  it('restores the stored session into a fresh module, as on a page reload', async () => {
    const original = startAuthenticatedSession()
    vi.resetModules()
    const reloaded = await import('./telemetry')
    reloaded.restoreAuthenticatedSession(true)
    expect(reloaded.getObservabilitySessionId()).toBe(original)
  })
  it('works in memory when storage is unavailable', () => {
    const set = sessionStorage.setItem
    sessionStorage.setItem = () => { throw new Error('storage denied') }
    try { expect(startAuthenticatedSession()).toBe(getObservabilitySessionId()) }
    finally { sessionStorage.setItem = set }
  })
})

describe('journey propagation and safe outcomes', () => {
  it('login has its own ID; lookup, review, failed submission and retry share the transfer parent', async () => {
    const login = startJourney('login')
    const loginCall = startApiTelemetry('/api/v1/auth/token', 'POST', login)
    expect(loginCall.headers['X-Session-ID']).toBeUndefined()
    loginCall.finish(200, false)
    completeJourney(login)
    startAuthenticatedSession()
    const transfer = startJourney('transfer')
    setJourneyStage(transfer, 'recipient_verify')
    const lookup = startApiTelemetry('/api/v1/accounts/lookup', 'POST', transfer)
    lookup.finish(404, true)
    recipientVerificationFailed(transfer, 'not_found')
    setJourneyStage(transfer, 'review')
    setJourneyStage(transfer, 'submit')
    const uncertain = startApiTelemetry('/api/v1/payments', 'POST', transfer)
    uncertain.finish(0, true)
    failJourney(transfer, 'network', true)
    const retry = startApiTelemetry('/api/v1/payments', 'POST', transfer)
    retry.finish(201, false)
    completeJourney(transfer)
    expect(login.correlationId).not.toBe(transfer.correlationId)
    for (const call of [lookup, uncertain, retry]) {
      expect(call.headers['X-Correlation-ID']).toBe(transfer.correlationId)
      expect(call.headers['X-Session-ID']).toBe(getObservabilitySessionId())
      expect(call.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
      expect(call.headers.traceparent.split('-')[1]).toBe(transfer.span.spanContext().traceId)
    }
    expect(lookup.headers.traceparent).not.toBe(retry.headers.traceparent)
    await flushTelemetry()
    const spans = exporters.spans.getFinishedSpans()
    const children = spans.filter(s => s.name === 'browser.api.request' && s.attributes.correlation_id === transfer.correlationId)
    expect(children).toHaveLength(3)
    expect(children.every(s => s.parentSpanContext?.spanId === transfer.span.spanContext().spanId)).toBe(true)
    expect(spans.find(s => s.name === 'browser.transfer')?.attributes.outcome).toBe('success')
    expect(exporters.logs.getFinishedLogRecords().map(l => l.body)).toContain('recipient_verification_failed')
  })
  it('cancellation/final outcomes are not counted twice', async () => {
    const journey = startJourney('transfer')
    cancelJourney(journey)
    completeJourney(journey)
    cancelJourney(journey)
    await flushTelemetry()
    expect(exporters.spans.getFinishedSpans().filter(s => s.name === 'browser.transfer')).toHaveLength(1)
    expect(exporters.logs.getFinishedLogRecords().filter(l => l.body === 'journey_cancelled')).toHaveLength(1)
    expect(exporters.logs.getFinishedLogRecords().some(l => l.body === 'journey_completed')).toBe(false)
  })
  it('captures recipient failure before source selection with its independent request ID', async () => {
    const request = startApiTelemetry('/api/v1/accounts/lookup', 'POST')
    request.finish(404, true)
    await flushTelemetry()
    const record = exporters.logs.getFinishedLogRecords().find(l => l.body === 'recipient_verification_failed')
    expect(record?.attributes.correlation_id).toBe(request.headers['X-Correlation-ID'])
    expect(record?.attributes['failure.category']).toBe('not_found')
    expect(exporters.logs.getFinishedLogRecords().some(l => l.body === 'journey_started')).toBe(false)
  })
  it('uses conservative HTTP categories rather than inspecting error bodies', () => {
    expect([0, 401, 403, 404, 409, 422, 429, 500].map(failureForStatus))
      .toEqual(['network', 'authentication', 'authentication', 'not_found', 'validation', 'validation', 'validation', 'internal'])
  })
})

describe('privacy and cardinality', () => {
  it('drops dynamic IDs/query text and refuses context injection to other origins', () => {
    const base = 'http://localhost:8000'
    expect(safeApiRoute(base + '/api/v1/accounts/private-account/transactions?token=secret', base))
      .toBe('/api/v1/accounts/{account_id}/transactions')
    expect(safeApiRoute(base + '/api/v1/payments/private-payment', base)).toBe('/api/v1/payments/{payment_id}')
    expect(safeApiRoute('https://other.example/api/v1/payments', base)).toBeUndefined()
    expect(safeApiRoute(base + '/unknown/secret', base)).toBeUndefined()
  })
  it('captures error kind without touching sensitive ErrorEvent or rejection fields', async () => {
    class SafeErrorEvent extends Event {
      get message() { throw new Error('must not read message') }
      get error() { throw new Error('must not read error') }
      get filename() { throw new Error('must not read filename') }
    }
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    vi.stubGlobal('ErrorEvent', SafeErrorEvent)
    const remove = installErrorCapture()
    target.dispatchEvent(new SafeErrorEvent('error'))
    const rejection = new Event('unhandledrejection')
    Object.defineProperty(rejection, 'reason', { get() { throw new Error('must not read reason') } })
    target.dispatchEvent(rejection)
    remove()
    await flushTelemetry()
    expect(exporters.spans.getFinishedSpans().filter(s => s.name === 'browser.javascript.error')).toHaveLength(2)
  })
  it('records only allowlisted span/log fields and low-cardinality metric labels', async () => {
    startAuthenticatedSession()
    const journey = startJourney('transfer')
    const request = startApiTelemetry('/api/v1/payments', 'POST', journey)
    request.finish(409, true)
    failJourney(journey, 'validation')
    recordNavigation('/private-customer?email=private', 12)
    captureJavaScriptError('unhandled_rejection')
    await flushTelemetry()
    const allowed = new Set(['correlation_id', 'session_id', 'journey.type', 'journey.stage', 'outcome',
      'failure.category', 'http.route', 'http.request.method', 'http.status_class', 'route.template', 'error.kind', 'trace_id'])
    for (const span of exporters.spans.getFinishedSpans()) {
      for (const key of Object.keys(span.attributes)) expect(allowed.has(key), key).toBe(true)
      for (const event of span.events) for (const key of Object.keys(event.attributes ?? {})) expect(allowed.has(key), key).toBe(true)
    }
    for (const log of exporters.logs.getFinishedLogRecords()) {
      for (const key of Object.keys(log.attributes)) expect(allowed.has(key), key).toBe(true)
    }
    const metrics = exporters.metrics.getMetrics().flatMap(r => r.scopeMetrics.flatMap(s => s.metrics))
    expect(metrics.some(m => m.descriptor.name === 'banking_web_api_duration')).toBe(true)
    for (const metric of metrics) for (const point of metric.dataPoints) {
      for (const key of Object.keys(point.attributes)) expect(key).not.toMatch(/correlation|trace|session|account_id|customer|payment_id|username/)
      expect(Object.values(point.attributes)).not.toContain(journey.correlationId)
      expect(Object.values(point.attributes)).not.toContain(journey.sessionId)
    }
    const exported = JSON.stringify([exporters.spans.getFinishedSpans().map(s => s.attributes), exporters.logs.getFinishedLogRecords().map(l => l.attributes)])
    expect(exported).not.toContain('private-customer')
    expect(exported).not.toContain('test-token-never-observed')
  })
})
