# Demo traffic generation

`scripts/generate-demo-traffic.ps1` creates paced, realistic backend activity against the running Happy Wallet API. It is intended to populate Grafana, Loki, Prometheus, and Tempo for demonstrations. It is not load testing, UI automation, or direct telemetry insertion.

## Prerequisites

- Run the normal Happy Wallet Docker stack.
- Use a valid synthetic username and password interactively when prompted.
- The user must own at least two accounts. The script uses their account UUIDs in memory and never prints them.
- PowerShell must be able to reach `http://localhost:8000` (or the `BaseUrl` supplied).

## Small validation profile

```powershell
.\scripts\generate-demo-traffic.ps1 `
  -SuccessfulLogins 5 `
  -FailedLogins 3 `
  -SuccessfulTransfers 6 `
  -InsufficientFundsFailures 3 `
  -InvalidRecipientFailures 2 `
  -IdempotencyReplays 2 `
  -IdempotencyConflicts 2 `
  -DelaySeconds 2 `
  -TransferAmount 0.01
```

## Dashboard/demo profile

```powershell
.\scripts\generate-demo-traffic.ps1 `
  -SuccessfulLogins 20 `
  -FailedLogins 8 `
  -SuccessfulTransfers 20 `
  -InsufficientFundsFailures 6 `
  -InvalidRecipientFailures 5 `
  -IdempotencyReplays 4 `
  -IdempotencyConflicts 4 `
  -DelaySeconds 4 `
  -TransferAmount 0.01
```

The in-memory login limiter allows five failed attempts from one client in five minutes. Later failed-login requests can therefore return HTTP 429 instead of 401; the script treats both as expected failed-login outcomes and continues.

## Scenarios and expected statuses

| Scenario | API activity | Expected status |
| --- | --- | --- |
| Setup and successful login | `POST /api/v1/auth/token` with OAuth2 form fields | 200 |
| Failed login | Same username with a generated incorrect password | 401, or 429 after the limiter threshold |
| Account discovery | `GET /api/v1/accounts` | 200 |
| Successful transfer | `POST /api/v1/payments` with a small decimal-string amount | 201 |
| Insufficient funds | Payment with `999999999999.99` | 409; the rejected payment is intentionally stored by the API |
| Invalid recipient | `POST /api/v1/accounts/lookup` with a generated nonexistent account number | 404 |
| Idempotent replay | Same key and identical payment twice | 201, then 200; the second request does not execute another transfer |
| Idempotency conflict | Same key with changed amount | 201, then 409; the changed request does not execute |

Successful transfers alternate between the first two accounts returned by the authenticated user's account list so the generator does not continually drain one account. Each logical activity gets a new UUID `X-Correlation-ID`. The two requests in a replay or conflict scenario intentionally share one correlation ID. Payment requests use a new valid `Idempotency-Key` for each logical activity.

## Privacy and safety

- Username and password are prompted interactively.
- The password is converted only temporarily for the form request, then released.
- JWT, account UUIDs, full account numbers, request bodies, response bodies, and payment IDs are not printed or saved.
- Correlation IDs and HTTP statuses are printed so one journey can be inspected safely.
- No database reset, schema change, application change, browser telemetry, or direct Grafana/Loki/Prometheus/Tempo insertion occurs.
- The generated successful and insufficient-funds payments are real synthetic business records. Use small amounts and a disposable POC environment.

## After generation

Run the existing validators; they are not modified by this tool:

```powershell
.venv-admin\Scripts\python.exe scripts\validate-poc.py
```

Copy a fresh correlation ID printed for a request and inspect its distributed journey:

```powershell
.venv-admin\Scripts\python.exe scripts\inspect-manual-journey.py <correlation-id>
```

The inspector searches the current Loki retention window (one day). It may report no evidence if the ID is too old or the services were restarted with cleared telemetry volumes.

## Manual UI activity still required

The generator intentionally does not create browser telemetry. Perform these separately through React when demonstrating frontend observability:

- successful UI login
- failed UI login
- page navigation
- successful UI transfer
- invalid-recipient attempt
