[CmdletBinding()]
param(
    [string]$BaseUrl = "http://localhost:8000",
    [int]$SuccessfulLogins = 5,
    [int]$FailedLogins = 3,
    [int]$SuccessfulTransfers = 6,
    [int]$InsufficientFundsFailures = 3,
    [int]$InvalidRecipientFailures = 2,
    [int]$IdempotencyReplays = 2,
    [int]$IdempotencyConflicts = 2,
    [int]$DelaySeconds = 2,
    [string]$TransferAmount = "0.01"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')

function New-CorrelationId {
    return [guid]::NewGuid().ToString()
}

function New-IdempotencyKey {
    return "demo-" + ([guid]::NewGuid().ToString("N"))
}

function Get-StatusCode([System.Management.Automation.ErrorRecord]$ErrorRecord) {
    try {
        if ($null -ne $ErrorRecord.Exception.Response.StatusCode) {
            return [int]$ErrorRecord.Exception.Response.StatusCode
        }
    } catch {
        # The response may be unavailable for transport-level failures.
    }
    return 0
}

function Invoke-DemoApi {
    param(
        [ValidateSet("GET", "POST")][string]$Method,
        [string]$Path,
        [hashtable]$Headers,
        [object]$Body
    )

    $requestHeaders = @{}
    if ($null -ne $Headers) {
        foreach ($key in $Headers.Keys) { $requestHeaders[$key] = $Headers[$key] }
    }

    $request = @{
        Uri = "$BaseUrl$Path"
        Method = $Method
        Headers = $requestHeaders
        UseBasicParsing = $true
        ErrorAction = "Stop"
    }
    if ($null -ne $Body) {
        $request.ContentType = "application/json"
        $request.Body = ($Body | ConvertTo-Json -Compress)
    }

    try {
        $response = Invoke-WebRequest @request
        $body = $null
        if (-not [string]::IsNullOrWhiteSpace($response.Content)) {
            $body = $response.Content | ConvertFrom-Json
        }
        return [pscustomobject]@{ StatusCode = [int]$response.StatusCode; Body = $body; TransportError = $false }
    } catch [System.Net.WebException] {
        return [pscustomobject]@{ StatusCode = (Get-StatusCode $_); Body = $null; TransportError = $false }
    } catch {
        return [pscustomobject]@{ StatusCode = 0; Body = $null; TransportError = $true }
    }
}

function Write-Result([string]$Scenario, [int]$StatusCode, [string]$CorrelationId, [int[]]$Expected) {
    $statusText = if ($StatusCode -eq 0) { "transport-error" } else { [string]$StatusCode }
    $expectedText = ($Expected -join "/")
    $resultText = if ($Expected -contains $StatusCode) { "PASS" } else { "CHECK" }
    Write-Host ("{0} {1} status={2} correlation_id={3} expected={4}" -f $resultText, $Scenario, $statusText, $CorrelationId, $expectedText)
}

function Pause-BetweenRequests {
    if ($DelaySeconds -gt 0) { Start-Sleep -Seconds $DelaySeconds }
}

function ConvertTo-FormBody([string]$Username, [string]$Password) {
    Add-Type -AssemblyName System.Web
    return "username=$([System.Web.HttpUtility]::UrlEncode($Username))&password=$([System.Web.HttpUtility]::UrlEncode($Password))"
}

Write-Host "Generating paced Happy Wallet API traffic at $BaseUrl"
Write-Host "Only HTTP statuses and safe correlation IDs will be printed."

$username = Read-Host "Synthetic username"
$passwordSecure = Read-Host "Synthetic password" -AsSecureString
$passwordPlain = $null
$token = $null
$accounts = $null

try {
    $passwordPtr = [IntPtr]::Zero
    try {
        $passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
        $passwordPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
    } finally {
        if ($passwordPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr) }
    }

    # Login once to obtain an in-memory bearer token for protected API scenarios.
    $loginCorrelation = New-CorrelationId
    $loginRequest = @{
        Uri = "$BaseUrl/api/v1/auth/token"
        Method = "POST"
        Headers = @{ "X-Correlation-ID" = $loginCorrelation }
        ContentType = "application/x-www-form-urlencoded"
        Body = (ConvertTo-FormBody $username $passwordPlain)
        ErrorAction = "Stop"
    }
    try {
        $loginResponse = Invoke-RestMethod @loginRequest
        $loginStatus = 200
        $token = $loginResponse.access_token
    } catch [System.Net.WebException] {
        $loginStatus = Get-StatusCode $_
    }
    Write-Result "setup login" $loginStatus $loginCorrelation @(200)
    if ($null -eq $token) { throw "Setup login failed; protected traffic cannot be generated." }

    $authHeaders = @{ Authorization = "Bearer $token" }
    $accountCorrelation = New-CorrelationId
    $accountResponse = Invoke-DemoApi -Method GET -Path "/api/v1/accounts" -Headers (@{ Authorization = "Bearer $token"; "X-Correlation-ID" = $accountCorrelation })
    Write-Result "account discovery" $accountResponse.StatusCode $accountCorrelation @(200)
    if ($accountResponse.StatusCode -ne 200 -or $null -eq $accountResponse.Body -or @($accountResponse.Body).Count -lt 2) {
        throw "The authenticated user must own at least two accounts."
    }
    $accounts = @($accountResponse.Body)
    $accountA = $accounts[0].account_id
    $accountB = $accounts[1].account_id

    for ($i = 1; $i -le $SuccessfulLogins; $i++) {
        $correlation = New-CorrelationId
        try {
            $response = Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/token" -Method POST `
                -Headers @{ "X-Correlation-ID" = $correlation } -ContentType "application/x-www-form-urlencoded" `
                -Body (ConvertTo-FormBody $username $passwordPlain) -ErrorAction Stop
            $status = 200
        } catch [System.Net.WebException] { $status = Get-StatusCode $_ }
        Write-Result "successful login $i" $status $correlation @(200)
        Pause-BetweenRequests
    }

    for ($i = 1; $i -le $FailedLogins; $i++) {
        $correlation = New-CorrelationId
        try {
            Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/token" -Method POST `
                -Headers @{ "X-Correlation-ID" = $correlation } -ContentType "application/x-www-form-urlencoded" `
                -Body (ConvertTo-FormBody $username ((New-Guid).ToString())) -ErrorAction Stop | Out-Null
            $status = 200
        } catch [System.Net.WebException] { $status = Get-StatusCode $_ }
        # 401 is invalid credentials; 429 is the application's login limiter after repeated failures.
        Write-Result "failed login $i" $status $correlation @(401, 429)
        Pause-BetweenRequests
    }

    for ($i = 1; $i -le $SuccessfulTransfers; $i++) {
        $source = if (($i % 2) -eq 1) { $accountA } else { $accountB }
        $destination = if (($i % 2) -eq 1) { $accountB } else { $accountA }
        $correlation = New-CorrelationId
        $response = Invoke-DemoApi -Method POST -Path "/api/v1/payments" `
            -Headers (@{ Authorization = "Bearer $token"; "X-Correlation-ID" = $correlation; "Idempotency-Key" = (New-IdempotencyKey) }) `
            -Body @{ source_account_id = $source; destination_account_id = $destination; amount = $TransferAmount }
        Write-Result "successful transfer $i" $response.StatusCode $correlation @(201)
        Pause-BetweenRequests
    }

    for ($i = 1; $i -le $InsufficientFundsFailures; $i++) {
        $source = if (($i % 2) -eq 1) { $accountA } else { $accountB }
        $destination = if (($i % 2) -eq 1) { $accountB } else { $accountA }
        $correlation = New-CorrelationId
        $response = Invoke-DemoApi -Method POST -Path "/api/v1/payments" `
            -Headers (@{ Authorization = "Bearer $token"; "X-Correlation-ID" = $correlation; "Idempotency-Key" = (New-IdempotencyKey) }) `
            -Body @{ source_account_id = $source; destination_account_id = $destination; amount = "999999999999.99" }
        Write-Result "insufficient funds $i" $response.StatusCode $correlation @(409)
        Pause-BetweenRequests
    }

    for ($i = 1; $i -le $InvalidRecipientFailures; $i++) {
        $correlation = New-CorrelationId
        $response = Invoke-DemoApi -Method POST -Path "/api/v1/accounts/lookup" `
            -Headers (@{ Authorization = "Bearer $token"; "X-Correlation-ID" = $correlation }) `
            -Body @{ account_number = "LAB-NONEXISTENT-$([guid]::NewGuid().ToString('N').Substring(0, 12))" }
        Write-Result "invalid recipient lookup $i" $response.StatusCode $correlation @(404)
        Pause-BetweenRequests
    }

    for ($i = 1; $i -le $IdempotencyReplays; $i++) {
        $source = if (($i % 2) -eq 1) { $accountA } else { $accountB }
        $destination = if (($i % 2) -eq 1) { $accountB } else { $accountA }
        $key = New-IdempotencyKey
        $body = @{ source_account_id = $source; destination_account_id = $destination; amount = $TransferAmount }
        $correlation = New-CorrelationId
        $first = Invoke-DemoApi -Method POST -Path "/api/v1/payments" -Headers (@{ Authorization = "Bearer $token"; "X-Correlation-ID" = $correlation; "Idempotency-Key" = $key }) -Body $body
        $second = Invoke-DemoApi -Method POST -Path "/api/v1/payments" -Headers (@{ Authorization = "Bearer $token"; "X-Correlation-ID" = $correlation; "Idempotency-Key" = $key }) -Body $body
        Write-Result "idempotency replay $i initial" $first.StatusCode $correlation @(201)
        Write-Result "idempotency replay $i duplicate" $second.StatusCode $correlation @(200)
        Pause-BetweenRequests
    }

    for ($i = 1; $i -le $IdempotencyConflicts; $i++) {
        $source = if (($i % 2) -eq 1) { $accountA } else { $accountB }
        $destination = if (($i % 2) -eq 1) { $accountB } else { $accountA }
        $key = New-IdempotencyKey
        $correlation = New-CorrelationId
        $firstBody = @{ source_account_id = $source; destination_account_id = $destination; amount = $TransferAmount }
        $conflictBody = @{ source_account_id = $source; destination_account_id = $destination; amount = "0.02" }
        $first = Invoke-DemoApi -Method POST -Path "/api/v1/payments" -Headers (@{ Authorization = "Bearer $token"; "X-Correlation-ID" = $correlation; "Idempotency-Key" = $key }) -Body $firstBody
        $second = Invoke-DemoApi -Method POST -Path "/api/v1/payments" -Headers (@{ Authorization = "Bearer $token"; "X-Correlation-ID" = $correlation; "Idempotency-Key" = $key }) -Body $conflictBody
        Write-Result "idempotency conflict $i initial" $first.StatusCode $correlation @(201)
        Write-Result "idempotency conflict $i changed request" $second.StatusCode $correlation @(409)
        Pause-BetweenRequests
    }
} finally {
    $passwordPlain = $null
    $passwordSecure = $null
    $token = $null
    $accounts = $null
}

Write-Host "Demo traffic generation complete. Correlation IDs above are safe to use for journey inspection."
