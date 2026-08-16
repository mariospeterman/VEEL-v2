# Incident response

1. Declare an incident, timestamp it, assign commander/communications/operations roles, and freeze production promotions.
2. Identify the active release manifest, previous healthy manifest, affected environment, providers, money/access/compliance authorities, and earliest known impact.
3. Preserve redacted logs, traces, audit rows, webhook receipts, database/provider evidence, and deployment records. Never paste secrets or raw PII into the incident channel.
4. Contain through reversible controls: disable the affected feature/provider path, stop unsafe worker classes, rotate exposed credentials, or repoint traffic to the previous immutable artifact. Do not manually manufacture payment, entitlement, ledger, or payout truth.
5. Validate `/healthz`, `/readyz`, synthetic journeys, settlement/access invariants, queues, and provider callbacks before restoring traffic.
6. Communicate user impact and regulatory/legal escalation through approved channels. Security, privacy, minor-safety, money, and compliance incidents require the corresponding specialist owner.
7. Close only after recovery evidence, reconciliation, corrective actions, owner/dates, and a blameless review are recorded.
