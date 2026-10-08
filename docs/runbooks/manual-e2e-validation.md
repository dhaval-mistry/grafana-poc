# Final manual E2E acceptance

This is a manual browser/Grafana procedure, not UI automation. Use the existing
local stack and privately held synthetic credentials. A successful transfer changes
synthetic balances; do not reset/drop/reseed the database to undo testing.

## Record for this final completion phase

Date: 2026-10-08, America/Los_Angeles. Prior isolated checks or an older successful
transfer do not prove this current complete frontend/backend journey. Each stage
remains NOT TESTED until its specific check is confirmed for this run. The user
performed login and a successful transfer; read-only storage checks below inspect
those manually selected requests, without browser automation.

| Stage | Status | Evidence required |
| --- | --- | --- |
| React UI | MANUAL PASS | User reports transfer success in React |
| Login | MANUAL PASS | User-selected login: HTTP 200 and frontend success log in storage |
| Session ID | MANUAL PASS | User confirms UUID exists and stays unchanged after reload; auth remains separate by code review |
| Correlation ID | MANUAL PASS | Distinct login/transfer IDs; matching frontend/backend logs and span attributes |
| traceparent | MANUAL PASS | Stored trace proves frontend CLIENT is parent of FastAPI SERVER; header was not copied |
| FastAPI | MANUAL PASS | Payment HTTP 201; correct frontend CLIENT parent in stored trace |
| Business spans | MANUAL PASS | payment.process, validate_accounts, validate_balance, persist and commit present |
| PostgreSQL | MANUAL PASS | SQL-operation child spans present with only db.system attributes |
| Alloy | NOT TESTED | Stored logs/traces prove routing; per-transfer metric increment not isolated |
| Loki | MANUAL PASS | Related frontend/backend records found for user-selected IDs |
| Prometheus | NOT TESTED | Expected frontend events/backend execution and duration series |
| Tempo | MANUAL PASS | Both services and browser/API/business/DB spans; parent assertions pass |
| Grafana | NOT TESTED | Three primary dashboards and both-direction drill-down work |

Only opaque correlation/trace IDs, safe timestamps, stage statuses and descriptions
belong in evidence. Never attach credentials, JWTs, profile/account details, amounts,
payment IDs, idempotency keys, raw SQL, bodies, HARs or raw exception output.

Safe evidence:

- Login correlation: `dec06d84-9924-474f-b8e9-aec6d8e3cb11`;
  trace: `28f3556735e146bbe87778ef9a224409`.
- Transfer correlation: `b3b5a5f4-89e5-47fa-9a99-2416f4a04e5b`;
  trace: `085a747fe661af85192c77af06be161b`.
- Loki returned three matching streams per request: backend request and frontend
  journey start/completion. No session value or banking data is recorded here.
- Exported span/event attribute keys match the safe allowlist; status descriptions
  are empty. This field check does not replace a complete browser payload/value audit.

Recheck the stored evidence while within retention:

```powershell
.\.venv-admin\Scripts\python.exe scripts/inspect-manual-journey.py b3b5a5f4-89e5-47fa-9a99-2416f4a04e5b
.\.venv-admin\Scripts\python.exe scripts/inspect-manual-journey.py dec06d84-9924-474f-b8e9-aec6d8e3cb11
```

## 1. Prepare

Open <http://localhost:5173> and <http://localhost:3000>. Sign into Grafana with
existing local credentials. Open DevTools Network with Preserve log; inspect
headers locally without copying authorization/body contents. Use a 30-minute
Grafana time range covering this run.

## 2. Login and session

Log out first, then log in using a synthetic customer's existing credentials.
In POST `/api/v1/auth/token`, record only correlation ID and the trace ID (second
segment of `traceparent`). Confirm a successful response. In Application → Session
Storage, verify `happy-wallet-observability-session` is an opaque UUID created
after login. Reload and verify it remains unchanged. The separate JWT key is an
auth credential: do not record it. Logout later should clear the observability ID.

## 3. One successful synthetic transfer

Choose the transfer type and source first. Use **My Accounts** for a small 0.01
transfer between two owned accounts. For a fuller verification path, **Someone
Else** can verify an existing synthetic recipient after source selection; enter
its number/label privately. Pick a destination, enter the amount, review and
confirm **once**. Record the success/failure state, not its sensitive text/fields.

Inspect payment POST (and recipient lookup, if used): same correlation/session ID,
same trace ID, different API span IDs. Login's correlation ID must differ. The
response `X-Correlation-ID` must match the request; it is visible in Network even
though JavaScript does not read that cross-origin response header. Do not clear
the existing idempotency key or repeat a payment to fix telemetry.

## 4. Inspect distributed trace

In Tempo, paste the payment request's trace ID. Confirm both service resources
and the hierarchy:

```text
browser.transfer (happy-wallet-web)
  browser.api.request
    FastAPI SERVER (synthetic-banking-api)
      payment.process
        payment.validate_accounts
        payment.validate_balance
        payment.persist
        payment.commit
        Psycopg SQL-operation spans
```

DB spans may sit under their corresponding stages. Check the server's parent span
ID equals the frontend CLIENT span ID. Inspect frontend API duration separately
from backend HTTP duration. No raw SQL, parameters, exception message/stack or
banking values may appear in attributes, events, names or status descriptions.

## 5. Logs and metrics

In Loki Explore, replace the placeholder with the opaque transfer correlation:

```logql
{service_name=~"happy-wallet-web|synthetic-banking-api"} | correlation_id = "PASTE_CORRELATION_ID"
```

Find `journey_started`/`journey_completed` and backend `api_request_completed` with
the same trace. Safe frontend stage events are also visible in the trace; successful
backend business operations do not emit a failure log.

In Prometheus, inspect existing series before/after the test (export can take 15–30s):

```promql
sum by(journey_type,event)(banking_web_journey_events_total)
sum(banking_web_api_duration_seconds_count)
sum(banking_login_success_total)
sum(banking_transfer_success_total)
sum(banking_payment_duration_seconds_count)
```

Verify safe labels only. Frontend event counts are not financial-execution counts.
Do not require precise one-event `increase()` values for newly appearing series.

## 6. Grafana and drill-down

In **Banking | Observability**, open Customer Experience, Journey Investigation and
API Health. In investigation, enter this correlation ID: frontend events, backend
request details and both-service logs should connect to the related trace. Empty
correlation input must show no correlated results.

Expand a Loki row → **View trace** → Tempo → **Logs**. Confirm it returns matching
trace records from both services where present. For a long journey select the
browser root/widen the time range. API Health remains a backend view; zero traffic
must show **No traffic**, distinct from 0% errors and missing telemetry.

## 7. Privacy and result recording

Inspect only `/otel/v1/*` browser payloads and exported span/log fields; banking
HTTP requests legitimately contain auth/business bodies. Check passwords, JWTs,
usernames, customer/account/recipient data, amounts, payment IDs, idempotency keys,
SQL/parameters, bodies and raw exception details are absent. Check all Prometheus
label keys for prohibited IDs. Do not record/private-data snapshots as evidence.

Change only actually checked stages to MANUAL PASS or FAIL, with safe evidence.
Unconfirmed stages stay NOT TESTED. A successful UI result without storage/trace
inspection is not a fully passed observability POC.
