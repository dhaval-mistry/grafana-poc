# Happy Wallet FastAPI application

The active application is `app/main.py`. Read the [root guide](../README.md),
[database implementation](../docs/database/README.md) and
[observability tutorial](../docs/observability/README.md).

## Application and endpoints

| Modules | Responsibility |
| --- | --- |
| `auth.py`, `security.py`, `login_limiter.py` | Activation, Argon2, JWT issuance/validation and process-local throttle |
| `customers.py`, `accounts.py` | Authenticated profile, owned accounts/history and recipient verification |
| `payments.py` | Ownership, idempotency, locking, atomic transfers and stored-result access |
| `database.py` | Restricted Psycopg connections/timeouts using a Docker secret |
| `request_context.py`, `telemetry.py` | Request context, SDKs, safe filtering/logger and business observations |
| `main.py`, `security_headers.py` | Routers, middleware ordering, CORS, generic validation and no-store headers |

| Endpoint | Purpose |
| --- | --- |
| GET `/health` | Process health only |
| POST `/api/v1/auth/activate` | One-time token activation/user creation |
| POST `/api/v1/auth/token` | OAuth2-form login and 30-minute JWT |
| GET `/api/v1/customers/me` | Verified user's profile |
| GET `/api/v1/accounts` | Owned accounts with masked numbers |
| POST `/api/v1/accounts/lookup` | Eligible recipient verification |
| GET `/api/v1/accounts/{account_id}/transactions` | Owned-account history |
| POST `/api/v1/payments` | Transfer with required `Idempotency-Key` |
| GET `/api/v1/payments/{payment_id}` | Sender/eligible recipient access to stored outcome |

## Security and banking semantics

Secrets come from Docker secret files. JWT verification requires signature,
issuer/audience, expiry/issued-at/subject and an active user. Passwords use Argon2.
Activation claim/user creation commit together; only activation token hashes are
stored. Failed-login throttling uses connection address in one process, not an
untrusted forwarded header.

The app connects as `banking_app`, not admin. Connection/query/lock/idle timeouts
bound waits. Generic errors avoid returning inputs or raw database exceptions.
No-store/security headers remain; Uvicorn access logs are disabled. API CORS permits
the existing local browser origin.

Payments serialize `(user, idempotency key)` with an advisory transaction lock,
check the stored request, then lock accounts in deterministic UUID order. Same
key/content replays the result; changed content conflicts. A fresh success commits
payment, balances and debit/credit entries atomically. An insufficient-funds
rejection commits only its payment record and returns 409 afterwards. Exceptions
roll back. Completed replay returns 200; a new success returns 201.

`PaymentTransaction` observes the original connection context's exit and forwards
its exact exception tuple/result. `payment.commit` does not replace transaction
management or suppress failures. These banking semantics are unchanged.

## Context and telemetry

Caller correlation IDs are validated against the bounded safe format (maximum
128 characters); valid values are preserved and missing/invalid ones replaced
with UUIDs. Optional session IDs use the same validation, are observability-only
ContextVars and never grant access. Responses return `X-Correlation-ID`; tokens
reset after each request to isolate concurrent context.

OTel wraps the application and extracts W3C `traceparent`. Within ordinary
Starlette middleware, the last registered runs first: request context precedes
telemetry, followed by security headers/CORS/router handling. The existing FastAPI
and Psycopg instrumentation remains intact.

Business spans: `login.authenticate`, `recipient.verify`, `payment.process`,
`payment.validate_accounts`, `payment.validate_balance`, `payment.persist`,
`payment.commit`. SQL is not manually instrumented again.

`banking.observability` exports only fixed request-completion/business-failure
events with approved metadata. Request fields: route/method/status/duration and
correlation/trace IDs. Failures add journey/stage/outcome/category. Backend session
context is stored but is not currently added to the span/log allowlist.

Counters cover requests, payment HTTP attempts, login outcomes, transfer attempts/
executions and recipient failures. Histograms cover API/login/payment duration.
Replays count attempts but not a second transfer execution; persisted rejected
payments count business failures. IDs never become metric labels.

`SafeSpanExporter` allowlists attributes/routes/operations, sanitizes span names
and drops SQL, exception events, link attributes and status descriptions before
OTLP export. Only the dedicated logger is collected, never root/framework logs.
All three signals use Alloy's private endpoint.

## Setup and checks

Follow [database setup](../docs/database/README.md) only for a fresh lab. Preserve
existing secrets and named volumes. From the repository root:

```powershell
docker compose -f compose.yaml -f compose.observability.yaml up -d --build --no-deps banking-api
Invoke-RestMethod http://localhost:8000/health
```

The overlay enables `OTEL_ENABLED`, sets the service name and Alloy endpoint,
and disables arbitrary header capture. Health/docs paths are excluded from tracing.

Use [automated checks](../docs/runbooks/automated-validation.md),
[business scenarios](../docs/runbooks/business-observability-validation.md) and
[manual E2E validation](../docs/runbooks/manual-e2e-validation.md). Regression and
concurrency scripts have different data effects; read them before execution.
