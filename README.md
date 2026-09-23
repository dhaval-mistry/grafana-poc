# Synthetic Banking API + Observability Lab

**Development status:** Step 14 payment API accepted against lab tests; Step 15 hardening patch supplied for validation, **not yet deployed or verified in your environment**. Use *synthetic data only*. This is not production-ready banking software.

## 1. Why this project exists

Build a realistic but small banking workflow before adding observability: customer activation -> JWT login -> own profile -> own accounts/transactions -> synthetic internal transfers. Later stages introduce OpenTelemetry on FastAPI, then React, frontend tracing and Grafana dashboards. The application must never collect actual customer data, real credentials or real money.

## 2. Repository layout

```text
grafana-poc/
  compose.yaml                    # Original Docker services and named volumes
  .secrets/                       # Create locally; NEVER commit
    postgres_password.txt
    banking_app_password.txt
    jwt_secret.txt
  banking-api/
    Dockerfile
    requirements.txt
    app/
      __init__.py
      main.py                     # FastAPI entry point, routers, middleware, health
      auth.py                     # Activation, Argon2 password checks, JWT issuance
      login_limiter.py            # Local single-process failed-login throttle
      security.py                 # JWT verification and customer lookup
      security_headers.py        # Cache and browser security headers
      database.py                # Restricted PostgreSQL connection + timeouts
      customers.py               # Current customer's profile (retain original)
      accounts.py                # Own accounts/history (retain original)
      payments.py                # Atomic synthetic transfers and status
    migrations/                   # Required original files, NOT supplied in patch
    seed/                         # Required original files, NOT supplied in patch
  tempo/tempo.yaml               # Required original config, NOT supplied in patch
```

**This ZIP is a PATCH, not the complete repository.** It contains changed/new Step 15 Python files and this README. Keep your original `customers.py`, `accounts.py`, migrations, seed scripts, Tempo config, compose.yaml, Dockerfile, requirements.txt and local secrets. If you want a fully reproducible repo, add those original files (excluding secrets) before using these instructions on a second machine.

## 3. Architecture and data flow

```text
Browser / Swagger (localhost:8000)
   -> FastAPI: request validation, auth, rate limits, security headers
   -> PostgreSQL as restricted banking_app role (Docker service name postgres)
   -> accounts, payments, debit/credit entries in one DB transaction

Grafana :3000; Loki :3100; Prometheus :9090; Tempo :3200
These services are currently separate; this patch does NOT instrument the API.
```

- `GET /health` tests API process only, **not** database connectivity.
- `POST /api/v1/auth/activate` consumes a single-use 30-minute activation token and creates an Argon2 password hash.
- `POST /api/v1/auth/token` authenticates and returns a 30-minute signed JWT. Failed logins are throttled per connection address in the local API process.
- `GET /api/v1/customers/me` derives the customer from a verified JWT.
- `GET /api/v1/accounts` lists only customer-owned accounts and masks numbers.
- `GET /api/v1/accounts/{account_id}/transactions` enforces account ownership.
- `POST /api/v1/payments` requires `Idempotency-Key` and the source account owner's JWT; commits payment/balances/debit/credit atomically.
- `GET /api/v1/payments/{payment_id}` permits sender and, for completed payments, recipient access.

## 4. Software prerequisites for a fresh Windows machine

1. Install Docker Desktop with Docker Compose and start Docker Desktop.
2. Install Python 3 for optional Windows-side admin/automated scripts and pgAdmin if you want a SQL user interface. The API itself runs using Python 3.12 inside Docker; Windows Python need not match it exactly.
3. Copy the **full original repository**, including `compose.yaml`, `banking-api/Dockerfile`, `banking-api/requirements.txt`, all original app files, migrations, seed scripts and `tempo/tempo.yaml`. The patch alone cannot initialize the database.
4. Keep service ports 3000, 3100, 3200, 4317, 4318, 5432 and 8000 free on localhost, or review/adjust compose port mappings deliberately. Do not expose these lab services publicly.

### Initial secrets (create only on your own machine)

In PowerShell from `C:\code\grafana-poc`:

```powershell
New-Item -ItemType Directory -Force .\.secrets | Out-Null
# Prompt interactively instead of putting a password in shell history.
$admin = Read-Host 'Create PostgreSQL admin password' -AsSecureString
$app = Read-Host 'Create restricted banking_app password' -AsSecureString
function Save-Secret($secret, $path) {
    $plain = [System.Net.NetworkCredential]::new('', $secret).Password
    [System.IO.File]::WriteAllText((Join-Path (Get-Location) $path), $plain)
}
Save-Secret $admin '.secrets/postgres_password.txt'
Save-Secret $app '.secrets/banking_app_password.txt'
# Generate a random JWT key. Never use a fixed example secret.
$key = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
[System.IO.File]::WriteAllText((Join-Path (Get-Location) '.secrets/jwt_secret.txt'), $key)
Remove-Variable admin,app,key,plain -ErrorAction SilentlyContinue
```

**Windows filesystem note:** Protect `.secrets` using local OS permissions. Do not publish backups or screenshots containing values. Ensure `.gitignore` includes `/.secrets/`, `/.venv-admin/` and test dumps. The SQL bootstrap must create `banking_app` using the same password as `banking_app_password.txt`. The Postgres Docker `POSTGRES_PASSWORD_FILE` setting takes effect when initializing a *new empty* Postgres volume; changing this file later does not automatically rotate an existing database password.

### First-time database creation (requires original migrations)

1. Start only PostgreSQL: `docker compose up -d postgres`.
2. Confirm readiness: `docker compose ps postgres`.
3. Run the original project database bootstrap, role setup and migrations **in their recorded order**. The known sequence from the development log is tracking `000_tracking.sql`, identity `001_identity.sql`, banking schema `002_banking_schema.sql`, activations `003_account_activation.sql` and permissions `004_activation_permissions.sql`; **the SQL bodies and precise initialization commands were not included with the supplied files, so do not invent or run placeholder SQL.** If an original database already exists, follow the existing migration tracker instead of blindly rerunning migrations.
4. Run the original `seed/001_master_data.sql` exactly once as designed, checking its prerequisites and idempotence first. Expected initial synthetic data: three customers and six accounts; this does not imply that an existing database should be reseeded.
5. Use original `seed/generate_activation.py` to create a single-use token for one customer, then activate via Swagger. Do not record/display tokens in shared logs.
6. Verify that the app role has the necessary **limited** permissions before starting FastAPI. This patch doesn't create roles or change grants.

For an **existing** database, do not repeat setup, `docker compose down -v`, drop the database, or reset balances. Preserve the entire `postgres-data` Docker volume.

### Start services

```powershell
cd C:\code\grafana-poc
docker compose config                    # Validate Compose before applying changes
docker compose up -d --build             # Full lab (only after original config files exist)
docker compose ps
Invoke-RestMethod http://localhost:8000/health
```

Swagger: `http://localhost:8000/docs`. Grafana: `http://localhost:3000`.
The Grafana/Loki/Prometheus/Tempo service configuration and dashboard provisioning belong to the *original repository* and future Steps 16/19; running containers alone doesn't prove collection or dashboards work.

## 5. Applying this Step 15 patch on the EXISTING lab

1. Record the baseline, ideally from pgAdmin:

```sql
SELECT
    (SELECT count(*) FROM public.payments) AS payments,
    (SELECT count(*) FROM public.transactions) AS transactions,
    (SELECT sum(balance) FROM public.accounts) AS total_balance;
```

2. Back up the original `banking-api` code to a uniquely named folder outside the repo or one ignored by Git. For DB recovery, follow your existing backup procedure; copying the code is **not** a database backup.
3. Extract ZIP and copy **only** `banking-api/app/*.py` from the ZIP over matching files in your original repo. Two new files are `login_limiter.py` and `security_headers.py`. Do not replace the original repo with the ZIP: it omits required modules.
4. Keep existing compose, requirements, Dockerfile, SQL and seeds unchanged. `main.py` already imports/installs `security_headers` in the uploaded source. The patch supplies that module because its content was not uploaded.
5. Validate syntax and rebuild *only* FastAPI:

```powershell
docker compose config
docker compose up -d --build --no-deps banking-api
Invoke-RestMethod http://localhost:8000/health
```

6. Verify security response headers:

```powershell
$r = Invoke-WebRequest http://localhost:8000/health
$r.Headers['Cache-Control']        # no-store, max-age=0
$r.Headers['Pragma']               # no-cache
$r.Headers['X-Content-Type-Options'] # nosniff
$r.Headers['Referrer-Policy']      # no-referrer
```

7. Run the **original** `banking-api/seed/test_api_regression.py` (not included in this patch) and verify baseline counts/total remain unchanged. Verify a valid login, JWT-protected access and a failed-login 429; try deliberately incorrect passwords only on synthetic lab accounts. After five failures from the same client within five minutes, a sixth attempt should return 429 (the fifth is still 401). Restarting the API resets in-memory counters; wait five minutes before retesting normal login if not restarting.
8. If anything fails, restore the backed-up source code and rebuild the banking-api service only. Do not manipulate stored payment balances to fix code errors.

## 6. Step 15 security decisions and known limits

**Implemented in patch:** session SQL timeouts; process-local failed-login throttle; no-store/other response headers; comments explaining payment transaction and locking; no changes to payment behavior, schema or data.

**Previously implemented, unchanged:** Argon2 password hashing, JWT signature/issuer/audience/expiry verification, ownership checks, idempotency key/locking, atomic transactions, generic validation errors, no Uvicorn access logging. The uploaded `security.py` and `payments.py` preserve those behaviors.

**Not implemented / not verified:** shared/distributed rate limiting; real client IP when behind a trusted proxy; complete constant-time username enumeration protection; strict request-body size controls for chunked bodies; per-endpoint amount limits/business policy; container running as non-root (Docker secret permissions need verification); fresh-system SQL bootstrap; full dependency vulnerability scan or reproducible transitive lockfile; HTTPS/reverse proxy, secure production browser sessions and CORS policy; full load/security audit. Do not call this a production hardening certification.

## 7. Useful troubleshooting

```powershell
docker compose ps banking-api postgres
docker compose logs banking-api --tail=50  # inspect locally; redact secrets before sharing
Invoke-RestMethod http://localhost:8000/health
```

- `ModuleNotFoundError: app.security_headers`: new module not copied to `banking-api/app/`.
- PostgreSQL timeout/503: verify PostgreSQL health and investigate query/lock delays; don't just increase limits without checking.
- 429 login after testing: wait for the five-minute window or restart the single-process lab API (this also interrupts active requests).
- Missing database tables: original migrations/bootstrap not applied. Do not guess table definitions from this README.
- Docker secret errors: confirm `.secrets` files exist and their application password matches the database role's current password.
- A successful `/health` does not imply DB connectivity; protected account retrieval exercises the DB.

## 8. Next milestones

Step 16: instrument FastAPI and PostgreSQL with OpenTelemetry for structured logs, metrics, traces and trace/correlation IDs. Verify a backend Grafana dashboard. Step 17: React frontend. Step 18: connect frontend telemetry and trace propagation. Step 19: polished Grafana dashboards and alerts. No observability changes are included here.

---

# Step 16: Backend OpenTelemetry (add-on, do not rebuild your database)

**Status:** Implementation package generated and static-checked; deployment and runtime verification are YOUR acceptance gate. This package is a patch, not a full repository. It does not include your SQL migrations, seed scripts, current `accounts.py`/`customers.py`, secrets, or original Grafana dashboard exports. Retain those unchanged. The Step 15 status in the earlier part of this README describes the historical patch; your reported 12 regression tests and 401×5/429 throttle test subsequently passed.

## Architecture and privacy

`Swagger / HTTP -> FastAPI + psycopg -> OTLP HTTP -> Alloy -> Loki (logs) / Prometheus (metrics) / Tempo (traces) -> Grafana`

- A new server-generated `X-Correlation-ID` header connects **one request** to its allowlisted log record and server span's `banking.correlation_id`. Generate the ID server-side to prevent hostile arbitrary strings entering logs.
- OpenTelemetry itself creates a 32-character trace ID; this joins the FastAPI request span to child PostgreSQL spans. Correlation ID and trace ID are different values. Open the log's trace ID in Grafana Explore > Tempo. Correlation ID is intentionally **not** a metrics label; use low-cardinality route templates and status codes.
- A `banking.observability` logger exports only the literal event name, sanitized route template, HTTP method/status, duration, correlation ID and trace ID. It does NOT attach to root logging, record HTTP headers, bodies, SQL parameters, user data, account IDs or exception text. Psycopg auto-instrumentation can emit parameterized SQL statement templates / SQL operation metadata; manually inspect actual spans before using real data. This is a synthetic-only lab, not a production security certification.
- Existing `--no-access-log` in Dockerfile is retained. You still need access control, network isolation and a full secret/PII audit for any real-world use. No payment business logic changes.

## Step 16 file inventory and copy rules

This ZIP is meant to be expanded into `C:\code\grafana-poc` **after making a folder backup**. It contains `compose.step16.yaml` (additive Compose overlay; do not replace `compose.yaml`), `banking-api/app/main.py`, new `banking-api/app/telemetry.py`, `banking-api/requirements.txt` (adds OTel packages), `alloy/config.alloy`, `prometheus/prometheus.yml`, `grafana/provisioning/datasources/step16.yaml`, `grafana/provisioning/dashboards/step16.yaml`, `grafana/dashboards/step16-banking-api.json`, and this root README.

No `loki-config.yaml` is necessary for this initial configuration: existing Loki 3.7.0 has native OTLP support **if its active schema uses tsdb/v13 and structured metadata is enabled**. If OTLP log export reports schema errors, STOP, inspect actual Loki configuration/data and plan a compatible schema change rather than overwriting an existing storage configuration. Tempo's existing `tempo/tempo.yaml` OTLP HTTP receiver on 4318 is reused unchanged. Existing manually configured Grafana data sources and dashboards are retained; the new Step16 sources use distinct names and UIDs.

**Prerequisites:** existing full project, Docker Desktop, working FastAPI /health, Loki /ready, Prometheus /-/ready, Tempo /ready, existing `.secrets` files. Do not use `docker compose down -v` or reset DB volumes. Port 12345 must be free on localhost. Existing `compose.yaml` is still required, and the original `postgres-data`, Grafana, Loki, Prometheus and Tempo volumes stay in use.

## 16.2 Backup, extract, validate (PowerShell)

```powershell
cd C:\code\grafana-poc
$backup = "banking-api-before-step16"
if (Test-Path ".\$backup") { throw "Backup already exists; stop rather than overwrite it." }
Copy-Item .\banking-api ".\$backup" -Recurse
# Replace path with your actual downloaded ZIP location.
Expand-Archive -Path "$HOME\Downloads\step16_backend_observability.zip" -DestinationPath "C:\code\grafana-poc" -Force
# Verify your original compose.yaml is unchanged; Step 16 uses an overlay.
docker compose -f compose.yaml -f compose.step16.yaml config --quiet
```

**Warning:** Step 16 provisions three new Grafana data sources with distinct UIDs. If you already have sources with these exact UIDs (`step16-prom`, `step16-loki`, `step16-tempo`), stop and reconcile provisioning first. Step 16 does not mount a replacement provisioning directory over Grafana's existing one.

## 16.3 Build and start ONLY affected components

```powershell
# Preserve Postgres, Loki, Tempo and their existing persistent volumes.
docker compose -f compose.yaml -f compose.step16.yaml up -d --build --no-deps alloy prometheus grafana banking-api
# If this command reports a startup failure, inspect logs; do not run payment tests.
docker compose -f compose.yaml -f compose.step16.yaml ps
# Alloy's HTTP UI helps diagnose pipeline configuration.
Invoke-WebRequest http://localhost:12345/-/ready
Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod http://localhost:3100/ready
Invoke-RestMethod http://localhost:9090/-/ready
Invoke-RestMethod http://localhost:3200/ready
```

Alloy has no host OTLP ingestion port; FastAPI reaches `http://alloy:4318` via the private Compose network. Prometheus's OTLP receiver is enabled by a command-line flag and receives from Alloy at `/api/v1/otlp/v1/metrics`; it is still bound to localhost on the host. The overlay remounts the existing `prometheus-data` volume. The first metrics can take ~10–30 seconds due to SDK export intervals.

**If Alloy config validation fails:**

```powershell
docker compose -f compose.yaml -f compose.step16.yaml logs alloy --tail=100
# Validate the syntax without starting another stack:
docker run --rm -v "${PWD}/alloy/config.alloy:/etc/alloy/config.alloy:ro" grafana/alloy:v1.10.2 validate /etc/alloy/config.alloy
```

Do not run `docker compose down` or delete existing volumes to fix a configuration error.

## 16.4 Verify trace + correlation ID without transferring money

```powershell
# Safe unauthenticated request: produces a 401, trace, metrics and sanitized log.
$response = Invoke-WebRequest http://localhost:8000/api/v1/accounts -SkipHttpErrorCheck
$response.StatusCode
$correlationId = $response.Headers["X-Correlation-ID"]
$correlationId
# A second request creates another correlation ID; they should be different.
Invoke-RestMethod http://localhost:8000/health
```

If your Windows PowerShell does not support `-SkipHttpErrorCheck`, use `try { Invoke-WebRequest ... } catch { $_.Exception.Response }` and obtain its response headers. Check the Grafana dashboard at http://localhost:3000, **Step16 Banking API** folder. In Loki Explore, start with `{service_name="synthetic-banking-api"}`; expand a record and look for `correlation_id`, `trace_id`, `http_route`, `http_status`. Query one ID using `{service_name="synthetic-banking-api"} | correlation_id = "<paste ID>"`. Structured metadata keys may vary with Loki resource mapping; inspect the received record if filtering fails.

In Tempo Explore search for service `synthetic-banking-api` then select a recent trace or paste the exact 32-character trace ID visible in the log; verify a server span and related PostgreSQL spans for an authenticated read request. For a DB trace, use `GET /api/v1/accounts` with a valid existing JWT via Swagger. Do NOT paste JWT/password into chat.

## 16.5 Verify metrics and dashboard

```powershell
# Allow at least 30 seconds following an API request, then query Prometheus.
Invoke-RestMethod 'http://localhost:9090/api/v1/query?query=banking_api_requests_total'
Invoke-RestMethod 'http://localhost:9090/api/v1/query?query=banking_api_duration_seconds_count'
Invoke-RestMethod 'http://localhost:9090/api/v1/query?query=banking_payment_requests_total'
```

`banking_payment_requests_total` appears **only after a POST /api/v1/payments attempt**. Use an authenticated request with an intentionally invalid negative amount and a fresh idempotency key so it cannot transfer funds; verify expected HTTP 422 and unchanged balances/records. If the Prometheus data source returns an empty vector initially, allow 30 seconds, check Alloy and Prometheus logs, and inspect actual exported names using the Prometheus API; SDK naming is version-dependent.

Dashboard panels: API request rate, HTTP 5xx rate, 95th-percentile latency, per-route status, payment response codes, recent allowlisted API logs, and a correlation-ID investigation panel. The initial dashboard uses static PromQL expressions and a textbox; metrics panels need several minutes of requests for rate() and quantiles to populate. The correlation ID textbox defaults to a deliberately nonexistent value until you paste a real one. Grafana provisioning includes a Tempo data source and a convenience Explore link; if the link cannot open a trace directly, paste the `trace_id` into Tempo Explore.

## 16.6 Regression, data integrity, PII audit and acceptance

```powershell
# Run from the original project root; do not put secrets in command lines.
.\.venv-admin\Scripts\python.exe .\banking-api\seed\test_api_regression.py
# Inspect only metadata; do not upload raw logs containing possible secrets.
docker compose -f compose.yaml -f compose.step16.yaml logs banking-api alloy --tail=100
```

Database read-only verification in pgAdmin (original `banking_lab`):

```sql
SELECT (SELECT COUNT(*) FROM public.payments) AS payments,
       (SELECT COUNT(*) FROM public.transactions) AS transactions,
       (SELECT SUM(balance) FROM public.accounts) AS total_balance;
```

The counts should match your pre-Step16 baseline; total funds were previously $57,250.00. If anything differs, stop and investigate. The suite's failed-login counter may be active for five minutes from earlier Step15 testing; wait for it to expire rather than resetting your database or removing limits.

**Acceptance:** (1) all four existing health/readiness checks pass; (2) Alloy ready; (3) 12 API regression tests and nondestructive check pass; (4) safe log shows correlation ID and trace ID; (5) Tempo server and DB spans appear; (6) API request and latency metrics appear in Prometheus and Grafana; (7) safe payment 422 increments payment requests counter without changing balances; (8) no passwords, JWTs, full account numbers, PII, raw SQL parameters or request bodies in any observed telemetry. Only then mark Step 16 complete.

## Troubleshooting and rollback without losing data

```powershell
# Check configuration and component startup errors.
docker compose -f compose.yaml -f compose.step16.yaml logs --tail=100 banking-api alloy prometheus grafana loki tempo
# If Step16 code or dependencies fail, restore the saved banking-api folder;
# restart banking-api with ONLY your original compose.yaml. Do not delete volumes.
docker compose -f compose.yaml up -d --build --no-deps banking-api
```

Restoring original code is a separate step: compare `banking-api-before-step16` with `banking-api`, then restore the original backend files from your verified backup before rebuilding. The overlay is opt-in; start the original stack using only `compose.yaml` to omit Alloy and the additional instrumentation environment, and stop the Alloy container explicitly if it remains active. `compose.yaml` never gets overwritten by this patch. Never drop `banking_lab`, remove `postgres-data` or invoke `docker compose down -v`.

**Fresh-machine note:** to reproduce the entire project you need the complete original source/migrations/seeds/Tempo config and locally generated secrets, not merely this add-on ZIP. Follow the earlier README steps to bootstrap the database, then apply this Step16 overlay. New machines should use pinned compatible versions after testing and should not make these lab endpoints Internet-accessible.
