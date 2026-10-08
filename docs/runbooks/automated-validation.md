# Existing non-UI automated validation

Run PowerShell from `C:\code\grafana-poc`. These are existing Vitest and Python
tests; no UI-automation framework is used. Keep all existing test files.

## Frontend

```powershell
cd banking-web
npm ci
npm test
npm run build
npm run lint
npm audit
npm audit --omit=dev
```

Stop Vite before clean installation on Windows, then start it in another terminal:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

The live SDK integration test uses real exporters/storage and synthetic invalid
authentication, not an automated browser or successful financial transfer:

```powershell
$env:VITE_OTEL_LIVE_TEST = 'true'
try {
  npm test -- src/observability/liveTelemetry.test.ts
  if ($LASTEXITCODE -ne 0) { throw 'Live telemetry integration failed' }
} finally {
  Remove-Item Env:VITE_OTEL_LIVE_TEST
}
```

Explicitly enabled production build (requires a production proxy at runtime):

```powershell
$env:VITE_OTEL_ENABLED = 'true'
try { npm run build } finally { Remove-Item Env:VITE_OTEL_ENABLED }
```

## Isolated backend telemetry

Run from the root. Mount current source/tests into ephemeral API containers;
mocked DB/auth dependencies do not change banking records. Use separate processes
because OpenTelemetry providers are process-global.

```powershell
docker compose -f compose.yaml -f compose.observability.yaml run --rm --no-deps -v C:/code/grafana-poc/banking-api/app:/app/app:ro -v C:/code/grafana-poc/banking-api/seed:/app/seed:ro banking-api python -m seed.test_request_context
docker compose -f compose.yaml -f compose.observability.yaml run --rm --no-deps -v C:/code/grafana-poc/banking-api/app:/app/app:ro -v C:/code/grafana-poc/banking-api/seed:/app/seed:ro banking-api python -m seed.test_business_telemetry
docker compose -f compose.yaml -f compose.observability.yaml config --quiet
```

## Existing banking regression

Credentials must be entered locally; do not paste them into chat or commit them.
The original regression script prompts for two existing synthetic users' passwords:

```powershell
.\.venv-admin\Scripts\python.exe .\banking-api\seed\test_api_regression.py
```

It checks balances/history at its own start/end and does not submit a valid new
payment. `test_concurrency.py` is a separate data-changing exercise, not automatically
run as part of documentation/dashboard cleanup. Read its own requirements first.
Without credentials, report regression SKIPPED, not PASS.

## Result policy

Dashboard queries, empty-correlation guards, current label privacy and local
Markdown links can be checked without any browser automation:

```powershell
.\.venv-admin\Scripts\python.exe scripts/validate-poc.py
# Static files/links only:
.\.venv-admin\Scripts\python.exe scripts/validate-poc.py --static
```

Record commands actually run with PASS/FAIL/SKIPPED. A quiet-period histogram gap,
an absent unobserved outcome series, or the default skip of the opt-in live test is
not proof of a broken exporter. Existing lint warnings/bundle-size warnings remain
visible; never hide them by claiming warning-free checks.

Final manual stage/evidence status is in [manual E2E](manual-e2e-validation.md).

## Executed results — 2026-10-08

| Command / check | Purpose | Result |
| --- | --- | --- |
| `npm uninstall --save-dev playwright` | Remove interrupted UI-only dependencies | PASS; two packages removed |
| `npm ci` (first attempt) | Clean installation | FAIL: running Vite held native DLL lock |
| `npm ci` (after stopping only project Vite) | Recheck manifest/lock consistency | PASS; Vite restarted afterwards |
| `npm ls --depth=0` | Dependency tree | PASS |
| `npm ls playwright playwright-core @playwright/test --all` | UI-package absence | PASS: empty tree (npm returns 1 for no match) |
| `npm test` | Existing API-client/frontend telemetry suites | PASS: 15 passed, opt-in live test skipped |
| `npm run build` | TypeScript and Vite build | PASS |
| `npm run lint` | Existing lint checks | PASS exit 0; existing Transactions effect-dependency warning remains |
| `npm audit` | All dependencies | PASS: zero vulnerabilities |
| `npm audit --omit=dev` | Runtime dependencies | PASS: zero vulnerabilities |
| Live SDK command above | Real SDK → Vite → Alloy → storage | PASS: one test; no automated browser |
| Backend request-context command above | Context validation/reset/correlation | PASS: 8 tests |
| Backend business-telemetry command above | Failure/rejection/replay/privacy semantics | PASS: 19 tests |
| Compose `config --quiet` command above | Effective configuration | PASS |
| `python scripts/validate-poc.py --static` | JSON/guards/local documentation links | PASS |
| `python scripts/validate-poc.py` | All provisioned panel queries, guards, labels | PASS; 595 current metric series at first passing run; no forbidden labels |
| `docker compose -f compose.yaml -f compose.observability.yaml restart grafana` | Reload provisioning | PASS |
| Read-only Grafana SQLite inspection in temporary helper container | Persisted dashboard folder and datasource configuration | PASS: four dashboards in existing folder; both-service links provisioned |
| GET Grafana `/api/health` | Grafana database/readiness | PASS: database ok |
| `git diff --exit-code -- banking-web/package.json banking-web/package-lock.json grafana/dashboards/happy-wallet-api-health.json` | Preserve packages and API Health | PASS: unchanged |
| `git diff --check` | Patch whitespace | PASS |
| `python scripts/inspect-manual-journey.py` with both IDs in manual record | Read-only evidence from user-run login/transfer | PASS: parent chain and safe attribute keys |
| Credential-prompted banking regression command above | Existing business regression | SKIPPED: local credentials unavailable to agent |
| Optional telemetry-enabled production build | Alternative production build configuration | NOT RUN in this completion phase |

Initial label validation incorrectly treated Loki result metadata as indexed labels.
The helper was corrected to query Loki's label API and rerun successfully; actual
indexed keys are `service_name`, `service_namespace`, `service_version`. This was a
validation-helper mistake, not an observed ID-label privacy leak.
