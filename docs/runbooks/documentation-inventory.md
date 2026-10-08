# Documentation inventory and reading order

Inventory at the start of final consolidation: five tracked Markdown files and
no additional project Markdown outside dependency/cache directories.

| Original document | Decision | Current location / retained content |
| --- | --- | --- |
| Root `README.md` | Preserve historical content; replace entry point | `poc-rollout-history.md` retains Step 15/16 rollout, safety, setup/rollback procedures; new root describes current POC |
| `banking-web/README.md` | Replace generic template; preserve reference | `frontend-template-history.md` retains template/tooling examples; new frontend README documents this app |
| `docs/business-observability-validation.md` | Move intact, add links | `business-observability-validation.md` here, including payment/replay/regression scenarios |
| `docs/grafana-backend-observability.md` | Move/rename and update | `grafana-observability-validation.md` here, including provisioning/navigation/history and the fourth dashboard |
| `docs/react-observability-validation.md` | Move/update scope statement | `react-observability-validation.md` here, retaining SDK/tests/browser privacy procedures |

No unique historical document was deleted. Obsolete claims in historical material
are explicitly superseded by current guides; do not execute archive commands as
current setup instructions.

```text
README.md
banking-web/README.md
banking-api/README.md
docs/
  database/README.md
  observability/README.md
  runbooks/
    automated-validation.md
    manual-e2e-validation.md
    business-observability-validation.md
    grafana-observability-validation.md
    react-observability-validation.md
    documentation-inventory.md
    poc-completion-report.md
    poc-rollout-history.md
    frontend-template-history.md
```

Read root → frontend/API → database → observability, then the appropriate runbook.
Internal relative links are checked against files after moves; external tool links
remain references. GitHub Markdown/Mermaid provide the diagrams without extra assets.
