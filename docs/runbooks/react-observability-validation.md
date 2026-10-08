# Step 4: React observability

Current implementation: [frontend README](../../banking-web/README.md).
Final acceptance: [manual E2E validation](manual-e2e-validation.md).

The frontend service is `happy-wallet-web`. Existing backend telemetry, banking
rules, authentication, database schema and Grafana dashboards remain unchanged.
Frontend signals reuse Alloy's existing OTLP receiver and exporters.

## Architecture and files

| File | Responsibility/change |
| --- | --- |
| `banking-web/src/observability/telemetry.ts` | Manual OTel providers, safe journey/context lifecycle, headers, metrics, logs and error capture |
| `banking-web/src/observability/NavigationTelemetry.tsx` | Known-route commit-to-next-frame timing, with StrictMode deduplication |
| `banking-web/src/observability/telemetry.test.ts` | In-memory SDK export checks for parenting, privacy, metric cardinality and lifecycle |
| `banking-web/src/api/apiClient.test.ts` | Request-header/error/auth/idempotency contract checks using mocked fetch |
| `banking-web/src/observability/liveTelemetry.test.ts` | Opt-in real exporter/proxy/Alloy/storage check using invalid authentication, with no banking writes |
| `banking-web/src/main.tsx` | Initialize providers once, install error handlers and best-effort flush on page hide |
| `banking-web/src/App.tsx` | Observe successful login/logout and restore the independent session before child-page requests |
| `banking-web/src/api/apiClient.ts` | Inject request context and observe duration without passing payloads or tokens to telemetry |
| `banking-web/src/pages/Login.tsx` | One journey per sign-in attempt, safe final outcome |
| `banking-web/src/pages/Transfer.tsx` | Journey starts at source selection and covers verification/review/submission/result/retries |
| `banking-web/vite.config.ts` | Same-origin `/otel/v1/traces`, `/otel/v1/metrics`, `/otel/v1/logs` proxy |
| `compose.observability.yaml` | Add only Alloy's loopback host port `127.0.0.1:4319:4318` for the Vite proxy |
| `banking-web/package.json`, `package-lock.json` | OTel SDK/exporters, Vitest and `npm test`; patch the existing vulnerable `source-map-js` transitive version |

Build compatibility fixes retain existing layout values: `Stack` alignment and
justification move to `sx` in Accounts, Dashboard, Login, Profile, Transactions
and Transfer; Login's `Box` text alignment also moves to `sx`. Material UI's
installed version no longer accepts those direct system props. Dashboard keeps its
existing route-triggered loading effect, with a narrowly documented lint exception.
No data loading, validation or payment rules change.

No automatic fetch, document, DOM, console or resource instrumentation is installed.
The explicit spans avoid raw URLs and banking data; explicit parent contexts avoid
async context leaking into another concurrent journey. The SDK packages provide
tracing, metrics, logging and OTLP HTTP export. W3C propagation comes from the OTel
core package. Vitest is a development-only test dependency.

## Context and behavior

- **Session:** successful login creates a UUID in
  `sessionStorage['happy-wallet-observability-session']`. Reload restores a valid
  UUID; logout clears it. Storage failures fall back to memory. It is separate
  from the JWT key and is never consulted for authentication or authorization.
  Failed/unauthenticated login attempts do not create an authenticated session.
- **Login:** each submit creates a new `browser.login` span and correlation UUID.
  The shared client creates a child API span and sends its trace context. The
  login journey finishes with success or a safe failure category.
- **Transfer:** selecting a source creates `browser.transfer` and its correlation
  UUID. Source changes cancel the previous journey. Changing transfer type starts
  a new journey if the source remains selected; it does not alter source selection
  behavior. Recipient verification, review, submission and result use that same
  context. Destination/amount edits keep the journey context while retaining the
  original idempotency-reset behavior.
- **Retries:** failed/uncertain submissions emit failure events but retain the
  transfer parent and correlation ID for another API child span. The idempotency
  key remains managed by existing code. Success ends/clears the journey before
  the existing account refresh. Unmount cancels any unfinished journey.
- **Before source selection:** the existing UI permits recipient lookup without
  a selected source. Such a request has an independent API correlation ID, since
  the transfer journey has not started. Its verification failures still emit safe
  events carrying the independent request's correlation ID. Select the source first to investigate
  verification and payment as one transfer journey.

Frontend journey events describe browser actions, not unique financial executions.
They must not replace backend success/failure counters for idempotency accounting.
HTTP 409 is conservatively classified as `validation`: several business failures
share that status. Backend business spans remain authoritative for insufficient
funds; frontend instrumentation never inspects an error body to infer it.

## Telemetry contract

Only known banking endpoints at the configured API origin receive:

| Header | Value |
| --- | --- |
| `X-Correlation-ID` | Journey UUID, or a fresh UUID for an independent API call |
| `X-Session-ID` | Optional authenticated observability session UUID |
| `traceparent` | W3C context of the frontend CLIENT span; FastAPI extracts it |

Authentication headers and body serialization stay in the existing request code.
No JWT is passed to telemetry. Different calls have different span IDs but the
same journey trace ID. Backend server spans parent to those frontend CLIENT spans;
existing Psycopg spans remain below the server/business spans.

Spans: `browser.login`, `browser.transfer`, `browser.api.request`,
`browser.navigation`, `browser.javascript.error`.

Safe attributes: `correlation_id`, optional `session_id`, `journey.type`,
`journey.stage`, `outcome`, `failure.category`, approved `http.route`,
`http.request.method`, `http.status_class`, `route.template`, `error.kind`.
Logs also have `trace_id`. Event names are fixed strings:
`journey_started`, `journey_completed`, `journey_failed`, `journey_cancelled`,
`recipient_verification_failed`, `javascript_error`. Stage events are span-only.

| Instrument | Safe metric attributes |
| --- | --- |
| `banking_web_journey_events` counter | `journey_type`, `event`, `outcome`, `failure_category` |
| `banking_web_api_duration` histogram, seconds | `http_route`, `http_method`, `http_status_class`, `outcome`, `failure_category` |
| `banking_web_navigation_duration` histogram, seconds | `route_template` |
| `banking_web_javascript_errors` counter | `error_kind`, `failure_category` |

Prometheus exposes counters with `_total` and duration histograms with
`_seconds_bucket`, `_seconds_count`, `_seconds_sum` suffixes. API duration covers
the shared client operation including response parsing. Navigation duration covers
route commit to the next frame, not data loading, paint completion or Web Vitals.
Approved page routes are `/`, `/login`, `/accounts`, `/transactions`, `/transfer`,
`/profile`; other paths become `UNMATCHED`. Dynamic account/payment API paths become
templates. Query strings, hashes, unknown paths and external origins are excluded.

Failure categories are bounded. HTTP failures map to `authentication` (401/403),
`not_found` (404), `validation` (other 4xx), `internal` (other failures), and
`network` (connection failure). `cancelled` is a distinct journey outcome.

Metric attributes never contain correlation/trace/session IDs, banking entity
IDs, usernames, amounts or idempotency keys. All signals exclude passwords, JWTs,
customer details, account numbers (including masked numbers), recipient labels,
amounts, payment IDs, bodies, raw SQL/parameters and raw exception text. Error
listeners never read the error/rejection value, message, stack, filename or URL.
The browser's own console output is not collected.

## Start and automated validation (PowerShell)

Run with the existing backend/storage stack already running:

```powershell
cd C:\code\grafana-poc
docker compose -f compose.yaml -f compose.observability.yaml up -d --no-deps alloy
docker compose -f compose.yaml -f compose.observability.yaml config --quiet

cd banking-web
npm ci
npm test
npm run build
npm run lint
npm audit --omit=dev
```

If the dev server is not running, in a separate terminal:

```powershell
cd C:\code\grafana-poc\banking-web
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://localhost:5173** (the existing API CORS origin). For the opt-in live
test, with Vite and all telemetry services running:

```powershell
$env:VITE_OTEL_LIVE_TEST = 'true'
try {
    npm test -- src/observability/liveTelemetry.test.ts
    if ($LASTEXITCODE -ne 0) { throw 'Live telemetry validation failed' }
} finally {
    Remove-Item Env:VITE_OTEL_LIVE_TEST
}
```

The live test uses the actual WebTracerProvider/exporters from a Node test runner.
It validates OTLP export, returned correlation IDs, FastAPI parent span IDs and
storage. It does not claim browser UI automation or a real successful transfer.

Dev export is enabled by default. Set `VITE_OTEL_ENABLED=false` to disable SDK
export. Production export is disabled unless the build sets
`VITE_OTEL_ENABLED=true`; a production same-origin `/otel/v1/*` proxy to the
collector is then required. Vite's development proxy is not a production server.
Exports are best-effort; hiding the page flushes buffers, but browser shutdown
delivery is not guaranteed. Failed export never retries a banking operation.

## Exact browser validation

Open DevTools **Network** with Preserve log enabled. Filter banking requests and
`otel` separately. Inspect headers locally; do not copy authentication headers or
body payloads into tickets or chat.

### Login

1. Log out, then sign in with your existing synthetic customer credentials.
2. Inspect POST `/api/v1/auth/token`: it has `X-Correlation-ID` and `traceparent`,
   and has no authenticated observability session ID on a clean sign-in.
3. Note only the correlation ID and trace ID (second segment of `traceparent`).
4. Application → Session Storage: confirm the new opaque
   `happy-wallet-observability-session` key. Reload: it stays unchanged. Logout:
   it disappears. A new successful login creates a different session ID.
5. An intentionally failed login has a different correlation ID and a safe
   `journey_failed` event. Existing throttling remains in effect.

### Successful transfer

Use synthetic lab accounts; a real successful transfer changes their balances.

1. Open Transfer, select the transfer type, then select the source account.
2. For **Someone Else**, verify a recipient using the existing workflow, proceed
   to review and submit. For own-account transfers there is no recipient lookup.
3. Inspect the lookup and POST `/api/v1/payments`: their `X-Correlation-ID` and
   `X-Session-ID` match. `traceparent` trace IDs match and span IDs differ.
4. The response's `X-Correlation-ID` matches the request (visible in Network even
   though it is not exposed to cross-origin JavaScript).
5. Starting the next transfer with another source selection gets a new correlation
   ID. The account-refresh request after completion is independent of the journey.

### Recipient verification failure

1. Choose **Someone Else**, select a source, then open Add New Recipient.
2. Enter a nonexistent synthetic account number twice and a local label.
3. The lookup fails as before. Its trace/log event records only the safe category
   `not_found`; no number or label appears in telemetry.
4. Correct the recipient and continue: the transfer correlation remains the same.

### JavaScript error

In DevTools Console, emit a synthetic ErrorEvent without crashing the UI:

```javascript
window.dispatchEvent(new ErrorEvent('error', {
  message: 'privacy-canary-must-not-export',
  error: new Error('privacy-canary-must-not-export')
}));
```

Wait for export. Loki should contain `javascript_error` and Tempo
`browser.javascript.error`; neither contains the canary/message/stack. The browser
console may show the synthetic event; console content is not collected.

### FastAPI propagation and storage

Grafana Explore → **Banking API | Observability | Tempo**, search a trace ID copied
from a transfer API request's `traceparent`. Inspect the trace tree:

```text
browser.transfer (happy-wallet-web)
  browser.api.request
    FastAPI server span (synthetic-banking-api)
      recipient.verify OR payment.process
        payment validation/persistence/commit and Psycopg spans
```

All frontend API children of that transfer share the same root trace. Tempo
TraceQL searches:

```traceql
{ resource.service.name = "happy-wallet-web" }
{ resource.service.name = "happy-wallet-web" && span.correlation_id = "PASTE_CORRELATION_ID" }
```

Grafana Explore → **Banking API | Observability | Loki**:

```logql
{service_name="happy-wallet-web"} | correlation_id = "PASTE_CORRELATION_ID"
{service_name="synthetic-banking-api"} | correlation_id = "PASTE_CORRELATION_ID"
{service_name="happy-wallet-web"} |= "javascript_error"
```

Use a narrow time range covering the test. Metrics in Prometheus:

```promql
sum by (journey_type,event,outcome,failure_category)(increase(banking_web_journey_events_total[15m]))
histogram_quantile(0.95, sum by (le,http_route)(rate(banking_web_api_duration_seconds_bucket[5m])))
sum by (route_template)(rate(banking_web_navigation_duration_seconds_count[5m]))
sum by (error_kind)(increase(banking_web_javascript_errors_total[15m]))
```

### Privacy inspection

Inspect **only `/otel/v1/*` payloads** in Network (banking requests legitimately
contain business bodies and auth headers). OTLP signal attributes/resource fields
must match the allowlists above. Search those payloads, Loki metadata and Tempo
attributes for the error canary and any synthetic sensitive values entered in the
UI: none should be present. Inspect Prometheus series labels: no correlation,
trace, session or banking entity IDs. Do not save HARs or copy banking request
bodies/headers as validation artifacts.

## Validation record and limits

The SDK/API unit suite, build and lint are checked during implementation. Lint has
one pre-existing Transactions effect-dependency warning and no errors. The live
integration test confirmed frontend/backend trace parenting, same returned IDs,
frontend Loki events and low-cardinality Prometheus series with synthetic invalid
authentication. Dependency audit is clean after the targeted transitive patch.

Final automated results on 2026-10-08: `npm test` passed 15 unit tests (the live
test is skipped by default); the opt-in live command passed its one test.
`npm run build` passed both with the default configuration and with
`VITE_OTEL_ENABLED=true`. `npm run lint` exited successfully with the existing
warning above. `npm audit --omit=dev` reported zero vulnerabilities. Compose
configuration validation passed, and an OPTIONS preflight returned HTTP 200 with
`traceparent`, `x-correlation-id`, and `x-session-id` allowed for the existing
`http://localhost:5173` origin. The telemetry-enabled production bundle has a
519 kB minified main chunk (about 161 kB gzip), triggering Vite's size warning;
code splitting can be considered separately.

Successful UI transfer, browser error-event export and Network privacy inspection
are manual acceptance steps. UI automation is intentionally excluded from this POC.
The final Grafana browser panels are described in the observability tutorial;
frontend action counts remain distinct from backend financial execution counters.
Web Vitals, session replay, console capture and public collector deployment are
not included.
