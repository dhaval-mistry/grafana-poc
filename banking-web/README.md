# Happy Wallet React application

Start with the [project walkthrough](../README.md). React, TypeScript, Vite,
Material UI and React Router provide the UI; pages use one shared API client.

## Structure and routes

`main.tsx` initializes telemetry before render. `App.tsx` owns routing, auth-token
presence and protected layout. `api/endpoints.ts` builds URLs and `api/apiClient.ts`
handles existing authentication, payload serialization, generic errors and headers.

| Route | Page |
| --- | --- |
| `/login` | Sign-in |
| `/` | Dashboard overview |
| `/accounts` | Owned accounts |
| `/transactions` | Owned-account history |
| `/transfer` | Destination/recipient selection, review and payment result |
| `/profile` | Authenticated profile |

Unknown routes use existing auth-aware redirects. Data shown on pages is never
copied into telemetry.

## Authentication and transfers

The JWT remains in `sessionStorage['happy-wallet-token']`. Authenticated requests
send a bearer credential; logout clears it. UI protection checks presence, while
FastAPI verifies claims, active user and ownership. The separate observability
session never determines access.

Transfer selects a type/source/destination, validates amount/balance locally,
opens review and submits. Existing idempotency keys are created at review,
preserved on uncertain failure and cleared after success or existing input resets.
Backend validation is authoritative. Do not alter these rules for telemetry.

## Browser observability

`observability/telemetry.ts` uses manual OTel spans, metrics and fixed event logs.
No automatic DOM/fetch/console capture or resource detection is installed.

- Successful login creates an opaque session UUID in a separate `sessionStorage`
  key. Reload restores it before child-page requests; logout clears it.
- Each sign-in attempt has its own correlation UUID and `browser.login` span.
- Source selection starts `browser.transfer`. Verification, review, submission,
  result and retries share context. Source/type changes begin a new journey;
  destination/amount edits retain context while existing idempotency resets apply.
- The client creates a CLIENT child and injects `X-Correlation-ID`, optional
  `X-Session-ID`, and W3C `traceparent` only for known banking-origin routes.
- Navigation measures route commit to the next frame. JS error capture records
  kind only, without reading message/stack/filename/rejection values.

Frontend events measure browser actions, not unique financial executions. HTTP
409 is conservatively `validation`; backend spans identify insufficient funds.
Recipient lookup before source selection has an independent request ID because
the transfer journey has not started.

Counters/histograms: `banking_web_journey_events`, `banking_web_api_duration`,
`banking_web_navigation_duration`, `banking_web_javascript_errors`. Safe labels are
bounded event/type/outcome/category, method/status class and route template.
IDs never become metric labels. Tokens, passwords, usernames, customer/account/
recipient data, amounts, payment IDs, idempotency keys, bodies and raw exceptions
are excluded from every signal.

## Setup and environment

```powershell
cd C:\code\grafana-poc\banking-web
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open <http://localhost:5173>. Stop the running project dev server before `npm ci`
on Windows. The checked-in `.env.development` supplies the local API base URL.
Never put credentials in Vite environment variables; they compile into public JS.

| Variable | Meaning |
| --- | --- |
| `VITE_API_BASE_URL` | Required banking API base URL |
| `VITE_OTEL_ENABLED` | Dev export defaults on unless `false`; production requires explicit `true` |
| `VITE_OTEL_LIVE_TEST` | Existing opt-in non-UI SDK integration test |

Vite relays three `/otel/v1/*` signal paths to loopback Alloy port 4319. Production
requires a same-origin proxy; Vite preview does not supply it. Existing API CORS
already permits the observability headers.

## Tests and acceptance

```powershell
npm test
npm run build
npm run lint
npm audit --omit=dev
```

Vitest tests SDK privacy/context and API contracts. The opt-in live test exercises
actual export/propagation with invalid authentication and no banking write. These
are retained non-UI tests; there is no Playwright/Cypress/Selenium suite.

Use [React procedures](../docs/runbooks/react-observability-validation.md),
[automated checks](../docs/runbooks/automated-validation.md) and
[manual E2E acceptance](../docs/runbooks/manual-e2e-validation.md).
[Observability](../docs/observability/README.md) explains the distributed trace tree.
Known limits include best-effort unload delivery, a pre-existing Transactions lint
warning, and the explicitly enabled production bundle's size warning.
