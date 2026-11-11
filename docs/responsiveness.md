# CRM responsiveness: staged changes

## First stage

The order list previously waited for the 30-second poll after navigation or closing a card. A background request started with a card open could also return after closing it and still leave the order list unchanged.

Navigation between sections and closing a card now request a fresh snapshot immediately. Requests are still combined by SnapshotReader. A navigation/close during a write is queued until the write ends. Background reads decide whether to preserve form data when their response is applied. Existing explicit refreshes and mutation responses retain their semantics. Periodic polling stays at 30 seconds and pauses while hidden/offline; this stage does not implement push updates between employees or replace the full snapshot API.

`Server-Timing` on normal `/api/crm` handler responses reports:

| Metric | Meaning |
| --- | --- |
| crm_read | POST's initial readState, including existing reconciliation |
| crm_snapshot | Building the authorized response state, including reminders |
| crm_total | Handler time through response construction; excludes the outer authentication wrapper, network transfer and browser rendering |

Metrics use fixed names and contain no identifiers, bodies or customer data. ETag and cache privacy remain unchanged. Early responses before entering the instrumented path may have no timing header.

Validation: `node tests/navigation-refresh.mjs`, `node tests/request-timing.mjs`, and the existing SnapshotReader concurrency tests. Both new suites are discovered by `tests/run-units.mjs`. Full compilation and HTTP suites run in the existing CRM build and release workflow.

## Acceptance after deployment

Use an authorized operator and a second authorized employee with access to the same synthetic/test order. Record initial GET, save POST, and the second employee's refresh separately. Check navigation, closing a card, a response arriving during close, unsaved input, offline/recovery, version conflicts and permissions. Do not create test orders in the working database without an agreed fixture/process.

Capture only aggregate latency and response size. Compare network time, Server-Timing and render time; a fast login page is not an authenticated CRM benchmark. Check the installed SHA in deploy-state/current when server access is available. GitHub success alone does not prove production installation.

## Subsequent stages

1. Measure real endpoints under agreed concurrent load; verify external import health separately.
2. Add authorized change notifications with replay/recovery and bounded incremental reads before increasing refresh frequency.
3. Replace full-state order-save processing with bounded reads and responses while preserving permissions, version checks, premium stages, timers and reminders.
4. Add server pagination, filtered counts and separate order history; preserve search/export/statistics semantics.
5. Move reconciliation to an independently verified job before removing it from reads. Existing disabled jobs must not be enabled automatically.
6. Profile SQL and SQLite write contention, event-loop delay, disk and CPU before changing hardware or database engines.

Target acceptance budgets, not measured results: second-employee visibility <=2s with push; ordinary save p95 <=1s; loaded-app list opening p95 <=1s. Agree workload and measure before claiming these budgets are met.
