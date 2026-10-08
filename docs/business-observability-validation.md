# Business observability validation

Run PowerShell from `C:\code\grafana-poc`. These checks use synthetic customers.
The successful-transfer check moves $1 between Alex's accounts. The insufficient-funds
check stores a rejected payment without moving funds. Replays create no additional
payment or ledger records. Use a fresh key for each new logical payment.

## 1. Isolated automated checks

These tests use mocked database/auth dependencies and in-memory telemetry; they do not
change lab records. Run separately because OpenTelemetry providers are process-global.

```powershell
docker compose -f compose.yaml -f compose.observability.yaml run --rm --no-deps -v C:/code/grafana-poc/banking-api/app:/app/app:ro -v C:/code/grafana-poc/banking-api/seed:/app/seed:ro banking-api python -m seed.test_business_telemetry
docker compose -f compose.yaml -f compose.observability.yaml run --rm --no-deps -v C:/code/grafana-poc/banking-api/app:/app/app:ro -v C:/code/grafana-poc/banking-api/seed:/app/seed:ro banking-api python -m seed.test_request_context
```

## 2. Deploy only the API and prepare helpers

```powershell
docker compose -f compose.yaml -f compose.observability.yaml up -d --build --no-deps banking-api
Invoke-RestMethod http://localhost:8000/health

Add-Type -AssemblyName System.Net.Http

function Invoke-LabPost {
    param([string]$Path, [hashtable]$Body, [hashtable]$Headers, [switch]$Form)
    $client = [System.Net.Http.HttpClient]::new()
    $message = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::Post, "http://localhost:8000$Path")
    try {
        foreach ($header in $Headers.GetEnumerator()) {
            $message.Headers.Add($header.Key, [string]$header.Value)
        }
        if ($Form) {
            $fields = [System.Collections.Generic.Dictionary[string,string]]::new()
            foreach ($field in $Body.GetEnumerator()) {
                $fields.Add($field.Key, [string]$field.Value)
            }
            $message.Content = [System.Net.Http.FormUrlEncodedContent]::new($fields)
        } else {
            $message.Content = [System.Net.Http.StringContent]::new(
                ($Body | ConvertTo-Json -Compress), [System.Text.Encoding]::UTF8, 'application/json')
        }
        $reply = $client.SendAsync($message).GetAwaiter().GetResult()
        try {
            $text = $reply.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            $data = $null
            try { $data = $text | ConvertFrom-Json } catch { }
            [pscustomobject]@{ StatusCode = [int]$reply.StatusCode; Data = $data }
        } finally { $reply.Dispose() }
    } finally { $message.Dispose(); $client.Dispose() }
}

function Get-LabMetric {
    param([string]$Query)
    $result = Invoke-RestMethod -Uri (
        'http://localhost:9090/api/v1/query?query=' + [uri]::EscapeDataString($Query))
    if ($result.data.result.Count -eq 0) { return 0 }
    return [double]$result.data.result[0].value[1]
}
```

Keep request results assigned to variables. Printing the entire login result would
display its JWT; the examples print HTTP statuses only.

## 3. Successful and failed login

```powershell
$loginId = 'obs-login-' + [guid]::NewGuid().ToString()
$loginBefore = Get-LabMetric 'sum(banking_login_success_total)'
$credential = [System.Net.NetworkCredential]::new(
    'alex.morgan', (Read-Host 'Alex synthetic password' -AsSecureString))
$login = Invoke-LabPost -Path '/api/v1/auth/token' -Form -Headers @{
    'X-Correlation-ID' = $loginId
} -Body @{ username = $credential.UserName; password = $credential.Password }
Remove-Variable credential
$login.StatusCode # 200
if ($login.StatusCode -ne 200) { throw 'Login failed; stop the transfer checks.' }
$labToken = $login.Data.access_token
Remove-Variable login

$failedLoginId = 'obs-login-failed-' + [guid]::NewGuid().ToString()
$failedLogin = Invoke-LabPost -Path '/api/v1/auth/token' -Form -Headers @{
    'X-Correlation-ID' = $failedLoginId
} -Body @{ username = 'observability-nonexistent-user'; password = 'synthetic-invalid-password' }
$failedLogin.StatusCode # 401; 429 if the existing login throttle is already active
```

Expected: `login.authenticate`, login attempts, success/failure counters, and login
duration observations. Failure category is `authentication` for 401 and 429.
Do not repeatedly run failed logins: the existing five-failure throttle remains active.

## 4. Successful transfer and idempotent replay

```powershell
$transferId = 'obs-transfer-' + [guid]::NewGuid().ToString()
$transferKey = [guid]::NewGuid().ToString()
$transferBody = @{
    source_account_id = '20000000-0000-4000-8000-000000000001'
    destination_account_id = '20000000-0000-4000-8000-000000000002'
    amount = '1.00'
}
$transferHeaders = @{
    Authorization = "Bearer $labToken"
    'X-Correlation-ID' = $transferId
    'Idempotency-Key' = $transferKey
}
$transferBefore = Get-LabMetric 'sum(banking_transfer_success_total)'
$transfer = Invoke-LabPost -Path '/api/v1/payments' -Headers $transferHeaders -Body $transferBody
$transfer.StatusCode # 201, assuming Alex's checking account has at least $1

Start-Sleep -Seconds 30
$successAfterTransfer = Get-LabMetric 'sum(banking_transfer_success_total)'
$attemptsAfterTransfer = Get-LabMetric 'sum(banking_transfer_attempts_total)'
$successAfterTransfer - $transferBefore # 1 if no other transfers ran

# Identical body AND key: same stored result; no new execution.
$replay = Invoke-LabPost -Path '/api/v1/payments' -Headers $transferHeaders -Body $transferBody
$replay.StatusCode # 200
$transfer.Data.payment_id -eq $replay.Data.payment_id # True; do not print the IDs
Start-Sleep -Seconds 30
(Get-LabMetric 'sum(banking_transfer_success_total)') - $successAfterTransfer # 0
(Get-LabMetric 'sum(banking_transfer_attempts_total)') - $attemptsAfterTransfer # 1
```

The first trace contains `payment.process` and its four stage spans. Replay contains
`payment.process` and `payment.commit`, without account/balance validation or persistence
spans because those blocks do not execute. Attempts and request-duration samples include
replays; execution success/failure counters exclude recognized replays.

## 5. Insufficient funds

```powershell
$ownedAccounts = Invoke-RestMethod -Uri 'http://localhost:8000/api/v1/accounts' -Headers @{
    Authorization = "Bearer $labToken"
}
$source = $ownedAccounts | Where-Object account_id -eq $transferBody.source_account_id
$rejectionBody = $transferBody.Clone()
$rejectionBody.amount = ([decimal]$source.balance + [decimal]1).ToString(
    '0.00', [System.Globalization.CultureInfo]::InvariantCulture)
$rejectionId = 'obs-insufficient-' + [guid]::NewGuid().ToString()
$rejectionHeaders = @{
    Authorization = "Bearer $labToken"
    'X-Correlation-ID' = $rejectionId
    'Idempotency-Key' = [guid]::NewGuid().ToString()
}
$rejection = Invoke-LabPost -Path '/api/v1/payments' -Headers $rejectionHeaders -Body $rejectionBody
$rejection.StatusCode # 409
$rejection.Data.error_code # INSUFFICIENT_FUNDS
```

Expected: `payment.validate_balance` and `payment.process` have failure outcome/category;
`payment.persist` and `payment.commit` succeed because the rejected record is intentionally
stored. `banking_transfer_failure_total{failure_type="insufficient_funds"}` increases once.
Replaying this same key/body returns 409 again without increasing that execution counter.

## 6. Recipient not found

```powershell
$recipientId = 'obs-recipient-' + [guid]::NewGuid().ToString()
$recipient = Invoke-LabPost -Path '/api/v1/accounts/lookup' -Headers @{
    Authorization = "Bearer $labToken"
    'X-Correlation-ID' = $recipientId
} -Body @{ account_number = 'LAB-NONEXISTENT-RECIPIENT' }
$recipient.StatusCode # 404
```

Expected: `recipient.verify` fails with category `not_found`, and the recipient failure
counter increases. This is not counted as a payment attempt.

## 7. Grafana Explore: traces and safe failure logs

Open `http://localhost:3000`, choose Explore, and set Last 15 minutes. Allow about 30 seconds
for export after each scenario. Copy the appropriate PowerShell ID (`$transferId`, etc.).

In **Banking API | Observability | Tempo**, run TraceQL (replace the value with your ID):

```traceql
{ span.correlation_id = "YOUR-CORRELATION-ID" }
```

Open the trace and expand the business spans. Check parent/child relationships, durations,
`correlation_id`, `journey.type`, `journey.stage`, `outcome`, and `failure.category` on failures.
The HTTP server span retains `banking.correlation_id`. Technical Psycopg spans retain timing
and safe operation metadata, with SQL text/parameters and exception details removed on export.

In **Banking API | Observability | Loki**, run:

```logql
{service_name="synthetic-banking-api"} |= "business_operation_failed"
```

Narrow to a scenario:

```logql
{service_name="synthetic-banking-api"} |= "business_operation_failed" | correlation_id = "YOUR-CORRELATION-ID"
```

Expand the log. Dotted attribute names appear normalized as `journey_type`, `journey_stage`,
and `failure_category` in Loki. Logs contain controlled stages/categories and opaque correlation
and trace IDs. They must contain no usernames, credentials, JWTs, account/customer/payment IDs,
amounts, SQL, recipient labels, or request/response bodies. Existing safe request-completion
logs remain available; only failures add the business-failure event.

## 8. Prometheus counters and histograms

Open `http://localhost:9090`, or use Grafana Explore → **Banking API | Observability | Prometheus**. Execute each:

```promql
sum(banking_login_attempts_total)
sum(banking_login_success_total)
sum by (failure_type) (banking_login_failure_total)
sum(banking_transfer_attempts_total)
sum(banking_transfer_success_total)
sum by (failure_type) (banking_transfer_failure_total)
sum by (failure_type) (banking_recipient_verification_failure_total)
sum by (outcome) (banking_login_duration_seconds_count)
sum by (outcome) (banking_payment_duration_seconds_count)
```

Each line is a separate query. Duration counts include success/failure HTTP attempts, including
replays. Execution outcome counters therefore need not sum to the attempt counter.
An outcome series first appears when that outcome occurs. Inspect individual series to confirm
only `journey`, `outcome`, and `failure_type` are business labels; collector/resource labels may
also exist, but correlation, trace, session and banking identifiers must not.

For latency trends after several minutes of traffic:

```promql
sum(rate(banking_login_duration_seconds_sum[5m])) / sum(rate(banking_login_duration_seconds_count[5m]))
histogram_quantile(0.95, sum by (le) (rate(banking_payment_duration_seconds_bucket[5m])))
```

Compare counter values before/after each scenario; `increase()` needs multiple samples and
can extrapolate. The existing API request, API duration, and payment HTTP-request metrics remain.

## 9. Existing regression suite and cleanup

```powershell
.\.venv-admin\Scripts\python.exe .\banking-api\seed\test_api_regression.py
Remove-Variable labToken, transferHeaders, rejectionHeaders, transfer, replay, ownedAccounts, source -ErrorAction SilentlyContinue
```

Enter Alex's and Jordan's synthetic passwords locally. Expected: 12 tests pass and
`Non-destructive verification: PASSED`. This suite compares balances/history at its own start/end;
the intentional transfer in section 4 occurred before that baseline. Do not reset or reseed the database.
