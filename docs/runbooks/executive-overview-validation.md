# Executive Overview — queries and validation

The source-controlled dashboard is [Executive Overview](../../grafana/dashboards/happy-wallet-executive-overview.json), provisioned by the existing directory provider into `Banking | Observability`. No provider, datasource, application or existing dashboard changes are needed.

Open <http://localhost:3000/d/happy-wallet-executive-overview>. Six large Stat panels use the existing Prometheus datasource (`step16-prom`). Default range is Last 24 hours; every expression uses the selected `$__range`. No charts, entity/context identifiers, technical latency or session metrics are displayed.

## KPI definitions and exact queries

Counts are estimated counter increases, displayed with two decimal places to avoid implying exact financial counts. Prometheus extrapolates boundary samples; first observations may not include a preceding zero. This dashboard does not repair that limitation or provide system-of-record reporting.

An absent outcome series falls back to zero only if the corresponding attempt counter has enough samples for `increase()`. Otherwise the Stat shows **No metric data**. Success rates use success / (success + failure), not attempts. Zero measured outcomes maps an internal `-1` sentinel to **No observed outcomes**; observed all-failure outcomes show **0%**. Positive-denominator filtering prevents division by zero, and `clamp_max(..., 100)` protects against floating-point overshoot.

### Successful Logins

Shows successful sign-in activity. Estimated counter increase in the selected dashboard range; fractional values are expected from Prometheus extrapolation. A newly observed counter's first increment may not be measurable. Missing outcome series are treated as zero only when attempt counter growth can be evaluated; absent/insufficient metric data stays unavailable. Each successful login retry counts again; this is not a unique-user count.

```promql
(sum(increase(banking_login_success_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_login_attempts_total{job="synthetic-banking-api"}[$__range]))))
```

### Failed Logins

Highlights authentication friction and failed sign-in activity. Estimated counter increase in the selected dashboard range; fractional values are expected from Prometheus extrapolation. A newly observed counter's first increment may not be measurable. Missing outcome series are treated as zero only when attempt counter growth can be evaluated; absent/insufficient metric data stays unavailable. Each failed login retry counts again.

```promql
(sum(increase(banking_login_failure_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_login_attempts_total{job="synthetic-banking-api"}[$__range]))))
```

### Login Success Rate

Summarizes the proportion of observed login outcomes that succeed. Successful login outcomes divided by successful plus failed login outcomes in the selected range. Retries count as separate outcomes. No observed outcomes is distinct from 0% success; missing/insufficient samples show No metric data.

```promql
clamp_max((100 * (sum(increase(banking_login_success_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_login_attempts_total{job="synthetic-banking-api"}[$__range])))) / (((sum(increase(banking_login_success_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_login_attempts_total{job="synthetic-banking-api"}[$__range])))) + (sum(increase(banking_login_failure_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_login_attempts_total{job="synthetic-banking-api"}[$__range]))))) > 0)), 100) or (vector(-1) and on() (((sum(increase(banking_login_success_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_login_attempts_total{job="synthetic-banking-api"}[$__range])))) + (sum(increase(banking_login_failure_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_login_attempts_total{job="synthetic-banking-api"}[$__range]))))) == 0))
```

### Successful Transfer Executions

Shows successful backend transfer execution outcomes, excluding recognized replays. Estimated counter increase in the selected dashboard range; fractional values are expected from Prometheus extrapolation. A newly observed counter's first increment may not be measurable. Missing outcome series are treated as zero only when attempt counter growth can be evaluated; absent/insufficient metric data stays unavailable. Uses backend outcome counters: recognized idempotent replays do not add successful executions. This is an operational estimate, not a ledger count.

```promql
(sum(increase(banking_transfer_success_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_transfer_attempts_total{job="synthetic-banking-api"}[$__range]))))
```

### Failed Transfer Executions

Highlights rejected or failed backend transfer execution outcomes. Estimated counter increase in the selected dashboard range; fractional values are expected from Prometheus extrapolation. A newly observed counter's first increment may not be measurable. Missing outcome series are treated as zero only when attempt counter growth can be evaluated; absent/insufficient metric data stays unavailable. Recognized idempotent replays are excluded. Unrecognized/pre-persistence retry failures may count again; failed validations and stored insufficient-funds rejections count. Recipient lookups are excluded.

```promql
(sum(increase(banking_transfer_failure_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_transfer_attempts_total{job="synthetic-banking-api"}[$__range]))))
```

### Transfer Success Rate

Summarizes successful outcomes among observed non-replay transfer outcomes. Successful non-replay transfer outcomes divided by successful plus failed non-replay transfer outcomes in the selected range, not payment attempts. Recognized replays are excluded; other retry failures can affect the rate. No observed outcomes and missing metric data have distinct states.

```promql
clamp_max((100 * (sum(increase(banking_transfer_success_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_transfer_attempts_total{job="synthetic-banking-api"}[$__range])))) / (((sum(increase(banking_transfer_success_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_transfer_attempts_total{job="synthetic-banking-api"}[$__range])))) + (sum(increase(banking_transfer_failure_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_transfer_attempts_total{job="synthetic-banking-api"}[$__range]))))) > 0)), 100) or (vector(-1) and on() (((sum(increase(banking_transfer_success_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_transfer_attempts_total{job="synthetic-banking-api"}[$__range])))) + (sum(increase(banking_transfer_failure_total{job="synthetic-banking-api"}[$__range])) or (0 * sum(increase(banking_transfer_attempts_total{job="synthetic-banking-api"}[$__range]))))) == 0))
```

## Retry semantics

Login retries count as separate successes/failures. Transfer attempts include retries and replay requests, but this dashboard uses `banking_transfer_success_total` and `banking_transfer_failure_total`, which exclude recognized idempotent replays. Pre-persistence failures, validation errors or conflicting retry payloads can still count again when they are not recognized as replays. Insufficient-funds stored rejection counts as failure. Recipient lookup failures are separate and do not affect transfer KPIs. These are not unique-user or deduplicated-journey counts.

## Manual validation

1. Open the dashboard in the existing folder; select Last 24 hours and confirm all six large Stat cards appear without panel errors. Hover each information icon for semantics.
2. Select Last 15 minutes; note baseline values. Log in privately with valid synthetic credentials, then perform one controlled wrong-password login. Avoid repeated attempts that trigger throttling.
3. Wait 45–60 seconds; refresh. Compare the login cards with API Health for the same time range. A new failure series may need a second event after its initial export to establish measurable growth.
4. Perform one small authorized synthetic transfer through Happy Wallet, confirming once. Wait 45–60 seconds and refresh. Compare successful execution outcomes with API Health. Do not reset/reseed balances or submit another payment merely to fix telemetry.
5. Do not expect nonexistent-recipient lookup to increase failed transfer executions: no payment was submitted. Use the existing business-telemetry test for safe insufficient-funds/replay validation rather than manufacturing financial writes or changing payload/idempotency behavior.
6. For quiet periods with established samples and zero outcome growth, rate cards show No observed outcomes. With insufficient/missing samples they show No metric data. They must not show NaN/infinity or falsely imply 100% success. A replay-only period has no new execution outcomes.
7. Counts may contain decimals because they are estimates; exact ledger counts and unique-user/session counts are outside this dashboard.

## Executed validation — 2026-10-09

- Live Prometheus: all six exact queries at 5m, 15m and 24h; finite values or empty results. Current short windows have insufficient metric data; 24h includes historical outcomes.
- Live Prometheus controlled aggregate fixtures for both rates: zero, mixed, all failed, all successful, missing success series, missing failure series, no metric data and attempts without execution outcomes. No banking requests are generated.
- Existing isolated `seed.test_business_telemetry`: 19 tests pass, including rejected-payment and replay exclusion; mocked DB/auth, no financial writes.
- Dashboard JSON, six Stat-only panels, selected-range use, persisted provisioning and preservation of the prior four dashboards checked. Existing dashboard source files remain unchanged.
- Browser rendering/manual financial actions are not performed by the agent in this task; use the procedure above.

The running API image excludes seed tests. Initial `docker exec ... -m seed.test_business_telemetry` could not find the module; the test passed in an ephemeral container with read-only app/seed mounts. Initial query validation detected a tiny percentage overshoot from floating-point arithmetic; rates were capped and revalidated. The initial database helper looked only in legacy storage; it was corrected to include Grafana's unified resource table. Grafana alone was restarted to load the final provisioned expressions, then checked again. Data volumes were preserved.

