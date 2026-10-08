# Happy Wallet backend observability in Grafana

All four banking dashboards are provisioned into **Banking | Observability**:

- **Happy Wallet | Journey Investigation** (`happy-wallet-journey-investigation`): correlation search, request details, recent failed journeys, safe logs and related traces.
- **Happy Wallet | API Health** (`happy-wallet-api-health`): request rate, HTTP 5xx percentage, telemetry freshness, API latency, business outcomes, business duration, failure categories, route/status rates, PostgreSQL span latency, slow traces and recent failures.
- **Banking API | Observability** (`step16-banking-api`): the original banking dashboard, retaining its existing live UID.
- **Happy Wallet | Customer Experience** (`happy-wallet-customer-experience`): browser journey events, API/navigation timing and JavaScript failures.

Current architecture: [observability tutorial](../observability/README.md).
The records below include historical checks; final manual acceptance belongs in
[manual E2E validation](manual-e2e-validation.md).

The provider is named **Banking API | Observability**. Datasource display names
are **Banking API | Observability | Prometheus**, **Banking API | Observability | Loki**,
and **Banking API | Observability | Tempo**. Legacy datasource UIDs `step16-prom`,
`step16-loki` and `step16-tempo` remain stable to preserve existing links. The
folder UID `bfyyz4nf7mmtcb` targets the existing folder and is also used on fresh
installations. After changing mount paths, recreate only Grafana:

```powershell
docker compose -f compose.yaml -f compose.observability.yaml up -d --no-deps --force-recreate grafana
```

Open <http://localhost:3000>. Sign in with your existing credentials. Dashboard JSON
is loaded from the existing mounted dashboard directory; do not import UI-only copies.

## Investigate a reported request

1. Open Journey Investigation and enter the reported correlation ID.
2. Choose a time range covering the request. Correlated request details and logs use
   exact equality, with Grafana's `doublequote` escaping. An empty textbox matches
   **no** correlated logs or traces. The recent-failures panels remain operational
   overview panels and are explicitly independent of the textbox.
3. Expand a correlated Loki log row and select **View trace** to open Tempo.
4. Select the relevant business span in Tempo and use its **Logs** link/icon to
   return to Loki. The query filters by the entire trace ID, with a one-minute
   window expansion on each side, so it includes completion and business-failure
   events regardless of the selected span's short duration.
5. Confirm the returned log has the same trace ID and correlation ID.

If the link is missing, confirm the selected sources are **Banking API | Observability | Loki** and
**Banking API | Observability | Tempo**, reload Grafana, and inspect the expanded log's structured
`trace_id` metadata. The Loki derived field matches that metadata key; it does not
try to extract a trace ID from the event-name message body.

## Safe fields and limitations

Loki bodies are `api_request_completed` and `business_operation_failed`. Indexed
labels identify the service/environment. Correlation and trace IDs are structured
metadata, never Prometheus labels.

| Event | Available structured fields used here |
| --- | --- |
| Request completion | `correlation_id`, `trace_id`, `http_route`, `http_method`, `http_status`, `duration_ms` |
| Business failure | `correlation_id`, `trace_id`, `journey_type`, `journey_stage`, `outcome`, `failure_category` |

Business failure events do not directly contain HTTP route/status/duration. The
recent-failed-journeys table joins them to request completions by **trace ID**;
joining by correlation ID would mix separate requests that reuse a correlation ID.
Each query is bounded to 500 events in the selected time range. Missing completion
fields are unavailable, not invented. Narrow the time range for busy periods.
Failure events can repeat on retries; that graph is an event count, not a count of
unique executed transfers.

Prometheus uses existing `journey` and `failure_type` labels. The metric panels do
not equate those names with Loki's `journey_type` and `failure_category`. Attempts
include idempotent replays; transfer success/failure execution counters exclude
replays. Rejected payments remain business failures even when persisted.

The 5xx panel divides only when the total rate is positive. A zero rate produces a
sentinel mapped to **No traffic**, while positive traffic without 5xx produces
**0%**. Missing rate data shows **No rate data**. The separate sample-age panel
helps identify stale/unavailable telemetry. API panels exclude `/health`.
Histogram quantiles require observed buckets; no samples produce gaps. Range
counter increases are estimates and can be fractional or miss the first event of
a newly created series. An absent failure series means no observed series, not a
guaranteed measured zero.

PostgreSQL quantiles use Tempo's existing TraceQL metrics API directly. Slow-trace
search returns up to 50 matching server traces above the selected threshold; it
does not rank all traces globally. No span-metrics generator is added.

Only approved safe telemetry fields are displayed. No credentials, JWTs, banking
entity identifiers, recipient names, amounts, bodies, SQL text/parameters or raw
exception messages are introduced. Application trace filtering remains in place;
this step changes neither it nor Alloy.

## Repeatable live checks

From the repository root in PowerShell, generate a request with no banking write:

```powershell
$correlation = 'grafana-check-' + [guid]::NewGuid().ToString('N')
curl.exe --silent --show-error --include --request POST `
  --header 'Content-Type: application/json' `
  --header "X-Correlation-ID: $correlation" `
  --data '{}' http://localhost:8000/api/v1/payments
$url = "http://localhost:3000/d/happy-wallet-journey-investigation?var-correlation_id=$correlation&from=now-15m&to=now"
Write-Output $url
```

Expect HTTP 401 and the same response correlation ID. Wait for telemetry export,
open the printed URL, and perform **both** navigation checks above. Confirm the
request details show `/api/v1/payments`, POST, 401, and an authentication failure.

Also verify:

- Empty correlation textbox: no correlated request/log/trace results.
- A nonexistent correlation ID: no correlated results.
- API Health: panels load without query errors. Zero traffic shows **No traffic**,
  not NaN/infinity or a misleading 0%; available positive traffic without server
  errors shows 0%. Missing counter series can legitimately have no data.
- PostgreSQL span latency renders when database spans exist in the selected range.
- Existing dashboard still opens, and unrelated dashboards remain present.

Use [business-observability-validation.md](business-observability-validation.md)
for synthetic successful login/transfer, insufficient funds, recipient failure and
idempotent replay scenarios. Those scenarios intentionally change lab data as
documented there; they are not necessary for testing navigation with the safe 401.

Step 3 acceptance requires backend query validation **and** confirmed live browser
navigation in both directions. Backend endpoint resolution alone does not establish
that Grafana rendered the clickable links correctly.

## Implementation validation record

Validated on 2026-10-07 (local time):

- Every dashboard PromQL, LogQL and TraceQL target executed successfully against
  the running local backends. Quiet-period duration queries had expected no-sample
  gaps; the 5xx percentage returned finite values.
- Empty and nonexistent correlation log searches returned zero records. The live
  request `step3-browser-d4fce3ac85bb42d4ad71e05f9a932901` returned two safe events
  sharing trace ID `95a3e36a1fa3c82a19e66970b89e5c21`.
- Real Loki metadata resolved to the Tempo trace; the reverse trace-ID query
  returned those same logs. The user confirmed both browser links worked.
- Zero-traffic percentage expression returned the **No traffic** sentinel;
  positive traffic with zero errors returned 0%, and 1 error / 10 requests returned 10%.
- The user confirmed API Health and the original dashboard opened without errors.
- The existing `banking-api.json` has no changes. On Grafana restart, provisioning
  logged a deprecated internal-ID conflict for that existing dashboard. The
  existing dashboard remains usable; resolving that internal-ID/provisioning
  state is outside this step and was not attempted.

## Folder consolidation

The subsequent folder cleanup targets the existing **Banking | Observability**
folder, not a second folder with a similar title. Provisioning files are now named
`banking-api-observability.yaml`; the Compose mounts and provider path use the same
naming. The original dashboard JSON now uses its actual live UID, correcting the
internal-ID conflict without creating a duplicate dashboard. Its title is
**Banking API | Observability**.

Datasource provisioning removes only the three old **Step16** datasource names
before recreating them with the same UIDs and the new display names. Unrelated
datasources are untouched. The legacy UIDs intentionally remain opaque stable
identifiers so saved panels, Explore links and bookmarks continue to work.

After applying the migration, verify all three banking dashboards are in the target
folder before deleting the empty **Step16 Banking API** folder through Grafana's
folder actions/settings. Never delete a nonempty folder. On this installation its
UID is `bg09tgzpnym80e`; the target folder is `bfyyz4nf7mmtcb`.

Migration validation: all three dashboards were confirmed in the target folder,
all three renamed datasources retained their UIDs and bidirectional links, and
Grafana reported a healthy database and successful dashboard provisioning. The
user deleted the empty old folder using their logged-in browser, and a read-only
storage check confirmed that only the target folder remains.
