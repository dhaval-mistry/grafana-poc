import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import type { Attributes, Context, Span } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'

export type JourneyType = 'login' | 'transfer'
export type JourneyStage = 'authenticate' | 'source_selected' | 'recipient_verify' | 'review' | 'submit' | 'result'
export type FailureCategory = 'authentication' | 'validation' | 'not_found' | 'insufficient_funds' | 'database' | 'internal' | 'network'
type Outcome = 'success' | 'failure' | 'cancelled'
type ApiRoute = '/api/v1/auth/token' | '/api/v1/customers/me' | '/api/v1/accounts' |
  '/api/v1/accounts/lookup' | '/api/v1/payments' |
  '/api/v1/accounts/{account_id}/transactions' | '/api/v1/payments/{payment_id}'
type SafeEvent = 'journey_started' | 'journey_completed' | 'journey_failed' | 'journey_cancelled' | 'recipient_verification_failed' | 'javascript_error'

export interface Journey {
  readonly correlationId: string
  readonly type: JourneyType
  readonly sessionId: string | undefined
  readonly context: Context
  readonly span: Span
  stage: JourneyStage
  ended: boolean
}

const SESSION_KEY = 'happy-wallet-observability-session'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
let sessionId: string | undefined
let providers: { traces: WebTracerProvider; metrics: MeterProvider; logs: LoggerProvider } | undefined
const propagator = new W3CTraceContextPropagator()

// No automatic instrumentation/resource detection: URLs, DOM values, bodies,
// browser identity and exception text must never become telemetry attributes.
export function initializeTelemetry() {
  if (providers || !(import.meta.env.VITE_OTEL_ENABLED === 'true' ||
    (import.meta.env.DEV && import.meta.env.VITE_OTEL_ENABLED !== 'false'))) return
  try {
    const resource = resourceFromAttributes({ 'service.name': 'happy-wallet-web' })
    const traces = new WebTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: '/otel/v1/traces' }))],
    })
    const metrics = new MeterProvider({
      resource,
      readers: [new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: '/otel/v1/metrics' }),
        exportIntervalMillis: 15000,
      })],
    })
    const logs = new LoggerProvider({
      resource,
      processors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: '/otel/v1/logs' }) })],
    })
    // Explicit parent contexts avoid global async context and cross-journey leaks.
    // Providers are used directly; no fetch patching or auth-aware exporter exists.
    providers = { traces, metrics, logs }
  } catch {
    // Observability initialization/export failures must not stop the banking UI.
    providers = undefined
  }
}

function tracer() {
  return providers?.traces.getTracer('banking.web.observability') ?? trace.getTracer('banking.web.observability')
}

function meter() {
  return providers?.metrics.getMeter('banking.web.observability')
}

// This storage key is independent of the JWT key and is never consulted by auth.
// Unavailable storage falls back to memory without changing login/logout behavior.
export function startAuthenticatedSession(): string {
  sessionId = crypto.randomUUID()
  try { sessionStorage.setItem(SESSION_KEY, sessionId) } catch { /* memory only */ }
  return sessionId
}

export function restoreAuthenticatedSession(authenticated: boolean) {
  if (!authenticated) { clearObservabilitySession(); return }
  if (sessionId) return
  try {
    const stored = sessionStorage.getItem(SESSION_KEY)
    if (stored && UUID.test(stored)) { sessionId = stored; return }
  } catch { /* memory only */ }
  startAuthenticatedSession()
}

export function clearObservabilitySession() {
  sessionId = undefined
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* memory only */ }
}

export function getObservabilitySessionId() { return sessionId }

function journeyAttributes(journey: Journey): Attributes {
  return {
    correlation_id: journey.correlationId,
    ...(journey.sessionId ? { session_id: journey.sessionId } : {}),
    'journey.type': journey.type,
    'journey.stage': journey.stage,
  }
}

function event(name: SafeEvent, journey?: Journey, outcome?: Outcome, failure?: FailureCategory) {
  const attributes: Attributes = {
    ...(journey ? journeyAttributes(journey) : {}),
    ...(outcome ? { outcome } : {}),
    ...(failure ? { 'failure.category': failure } : {}),
  }
  journey?.span.addEvent(name, attributes)
  const spanContext = journey?.span.spanContext()
  // Explicit fields make Loki search possible without relying on log-body parsing.
  providers?.logs.getLogger('banking.web.observability').emit({
    body: name,
    context: journey?.context ?? ROOT_CONTEXT,
    attributes: { ...attributes, ...(spanContext?.traceId ? { trace_id: spanContext.traceId } : {}) },
  })
  if (journey) {
    // Construct metric labels separately: never spread span/log attributes here.
    meter()?.createCounter('banking_web_journey_events').add(1, {
      journey_type: journey.type, event: name, outcome: outcome ?? 'started',
      failure_category: failure ?? 'none',
    })
  }
}

export function startJourney(type: JourneyType): Journey {
  const correlationId = crypto.randomUUID()
  const stage = type === 'login' ? 'authenticate' : 'source_selected'
  const span = tracer().startSpan(`browser.${type}`, {
    attributes: {
      correlation_id: correlationId, 'journey.type': type, 'journey.stage': stage,
      ...(sessionId ? { session_id: sessionId } : {}),
    },
  }, ROOT_CONTEXT)
  const journey: Journey = {
    correlationId, type, sessionId, span,
    context: trace.setSpan(ROOT_CONTEXT, span), stage, ended: false,
  }
  event('journey_started', journey)
  return journey
}

export function setJourneyStage(journey: Journey | undefined, stage: JourneyStage) {
  if (!journey || journey.ended) return
  journey.stage = stage
  journey.span.addEvent('journey_stage', { 'journey.stage': stage })
}

export function completeJourney(journey: Journey) {
  if (journey.ended) return
  setJourneyStage(journey, 'result')
  event('journey_completed', journey, 'success')
  journey.span.setAttribute('outcome', 'success')
  // Earlier retry failures remain events; the final successful span outcome
  // must not carry a stale failure category.
  journey.span.setAttribute('failure.category', 'none')
  journey.span.setStatus({ code: SpanStatusCode.OK })
  journey.span.end()
  journey.ended = true
}

export function failJourney(journey: Journey, category: FailureCategory, keepForRetry = false) {
  if (journey.ended) return
  event('journey_failed', journey, 'failure', category)
  journey.span.setAttributes({ outcome: 'failure', 'failure.category': category })
  journey.span.setStatus({ code: SpanStatusCode.ERROR })
  // An uncertain payment retains both the correlation ID and parent context,
  // independently of the existing idempotency key. Later retries are new children.
  if (!keepForRetry) { journey.span.end(); journey.ended = true }
}

export function cancelJourney(journey: Journey | undefined) {
  if (!journey || journey.ended) return
  event('journey_cancelled', journey, 'cancelled')
  journey.span.setAttribute('outcome', 'cancelled')
  journey.span.end()
  journey.ended = true
}

export function recipientVerificationFailed(journey: Journey | undefined, category: FailureCategory) {
  if (journey && !journey.ended) event('recipient_verification_failed', journey, 'failure', category)
}

// Map only known API paths. Dynamic IDs, query strings and unknown paths are
// discarded; only calls to the configured banking origin receive context headers.
export function safeApiRoute(url: string, apiBaseUrl: string): ApiRoute | undefined {
  try {
    const base = new URL(apiBaseUrl)
    const target = new URL(url, base)
    if (target.origin !== base.origin) return undefined
    const prefix = base.pathname.replace(/\/$/, '')
    const path = target.pathname.slice(prefix.length)
    if (prefix && !target.pathname.startsWith(prefix + '/')) return undefined
    const fixed: readonly ApiRoute[] = ['/api/v1/auth/token', '/api/v1/customers/me', '/api/v1/accounts', '/api/v1/accounts/lookup', '/api/v1/payments']
    const matched = fixed.find(route => route === path)
    if (matched) return matched
    if (/^\/api\/v1\/accounts\/[^/]+\/transactions$/.test(path)) return '/api/v1/accounts/{account_id}/transactions'
    if (/^\/api\/v1\/payments\/[^/]+$/.test(path)) return '/api/v1/payments/{payment_id}'
    return undefined
  } catch { return undefined }
}

export function failureForStatus(status: number): FailureCategory {
  if (status === 0) return 'network'
  if (status === 401 || status === 403) return 'authentication'
  if (status === 404) return 'not_found'
  if (status >= 400 && status < 500) return 'validation'
  return 'internal'
}

export function startApiTelemetry(route: ApiRoute, method: string, journey?: Journey) {
  const correlationId = journey?.correlationId ?? crypto.randomUUID()
  const currentSession = journey?.sessionId ?? sessionId
  const safeMethod = method === 'GET' || method === 'POST' ? method : 'OTHER'
  const span = tracer().startSpan('browser.api.request', {
    kind: SpanKind.CLIENT,
    attributes: {
      correlation_id: correlationId, 'http.route': route, 'http.request.method': safeMethod,
      ...(currentSession ? { session_id: currentSession } : {}),
      ...(journey ? { 'journey.type': journey.type, 'journey.stage': journey.stage } : {}),
    },
  }, journey?.context ?? ROOT_CONTEXT)
  const headers: Record<string, string> = { 'X-Correlation-ID': correlationId }
  if (currentSession) headers['X-Session-ID'] = currentSession
  // Propagate this CLIENT span, not the journey root: FastAPI then becomes its
  // direct SERVER child. Explicit ROOT_CONTEXT also excludes incidental baggage.
  propagator.inject(trace.setSpan(ROOT_CONTEXT, span), headers, {
    set(carrier, key, value) { carrier[key] = value },
  })
  const started = performance.now()
  let finished = false
  return {
    headers,
    finish(status: number, failed: boolean) {
      if (finished) return
      finished = true
      const statusClass = status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` : 'network'
      const category = failed ? failureForStatus(status) : 'none'
      span.setAttributes({ 'http.status_class': statusClass, outcome: failed ? 'failure' : 'success' })
      if (failed) {
        span.setAttribute('failure.category', category)
        span.setStatus({ code: SpanStatusCode.ERROR })
      }
      // The existing UI allows lookup before source selection. Record that
      // independent request's failure without inventing a transfer journey or
      // losing its own correlation ID. Journey-bound failures are logged by UI.
      if (route === '/api/v1/accounts/lookup' && failed && !journey) {
        const failure = failureForStatus(status)
        const attributes: Attributes = {
          correlation_id: correlationId, trace_id: span.spanContext().traceId,
          ...(currentSession ? { session_id: currentSession } : {}),
          'journey.type': 'transfer', 'journey.stage': 'recipient_verify',
          outcome: 'failure', 'failure.category': failure,
        }
        span.addEvent('recipient_verification_failed', attributes)
        providers?.logs.getLogger('banking.web.observability').emit({
          body: 'recipient_verification_failed',
          context: trace.setSpan(ROOT_CONTEXT, span), attributes,
        })
        meter()?.createCounter('banking_web_journey_events').add(1, {
          journey_type: 'transfer', event: 'recipient_verification_failed',
          outcome: 'failure', failure_category: failure,
        })
      }
      span.end()
      meter()?.createHistogram('banking_web_api_duration', {
        unit: 's', advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] },
      }).record(
        (performance.now() - started) / 1000,
        { http_route: route, http_method: safeMethod, http_status_class: statusClass,
          outcome: failed ? 'failure' : 'success', failure_category: category },
      )
    },
  }
}

export function safePageRoute(path: string): string {
  return ['/', '/login', '/accounts', '/transactions', '/transfer', '/profile'].includes(path) ? path : 'UNMATCHED'
}

export function recordNavigation(path: string, durationMs: number) {
  const route = safePageRoute(path)
  const span = tracer().startSpan('browser.navigation', {
    attributes: { 'route.template': route },
    startTime: new Date(Date.now() - durationMs),
  }, ROOT_CONTEXT)
  span.end()
  meter()?.createHistogram('banking_web_navigation_duration', {
    unit: 's', advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] },
  }).record(durationMs / 1000, { route_template: route })
}

export function captureJavaScriptError(kind: 'error' | 'unhandled_rejection') {
  // Do not read ErrorEvent/error/reason, message, stack, filename or source URL.
  const span = tracer().startSpan('browser.javascript.error', {
    attributes: { 'error.kind': kind, 'failure.category': 'internal', outcome: 'failure', ...(sessionId ? { session_id: sessionId } : {}) },
  }, ROOT_CONTEXT)
  span.setStatus({ code: SpanStatusCode.ERROR })
  span.end()
  providers?.logs.getLogger('banking.web.observability').emit({
    body: 'javascript_error', context: trace.setSpan(ROOT_CONTEXT, span),
    attributes: { trace_id: span.spanContext().traceId, 'error.kind': kind,
      outcome: 'failure', 'failure.category': 'internal', ...(sessionId ? { session_id: sessionId } : {}) },
  })
  meter()?.createCounter('banking_web_javascript_errors').add(1, { error_kind: kind, failure_category: 'internal' })
}

export function installErrorCapture() {
  const onError = (error: Event) => {
    // Resource-load errors are not JavaScript exceptions and can expose URLs.
    if (error instanceof ErrorEvent) captureJavaScriptError('error')
  }
  const onRejection = () => captureJavaScriptError('unhandled_rejection')
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

export async function flushTelemetry() {
  // Best effort; the UI never waits for export success or retries banking calls.
  if (providers) await Promise.allSettled(Object.values(providers).map(provider => provider.forceFlush()))
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (providers) void Promise.allSettled(Object.values(providers).map(provider => provider.shutdown()))
  })
}
