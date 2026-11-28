# Project settings editor — ALE-41

This branch implements a draft editor and a deliberately limited native settings adapter. Both are disabled by default. Set `OKTELL_PROJECT_SETTINGS=1` only in the isolated lab to expose `/oktell-projects` to signed-in administrators. Operators, department heads, test-only accounts and impersonated sessions cannot use this API. No new background tasks are installed.

The editor stores named projects, operators, dialing/retry rules, schedules, client-local time, queue limits, operator text, results and callback preferences in two new CRM tables. Saves are version checked and audited atomically. Replaying the same save after a lost response does not create an additional version. Previous versions can be loaded into the form and explicitly saved as a new version. No delete operation is exposed.

The T1 preset is based on the settings recorded on 2026-10-28, not a live read of Skorozvon: predictive, six lines, 50 seconds ringing, three total attempts, six retry outcomes, the recorded weekly schedule and 09:00–20:00 client time. It includes no people, contacts, native IDs, caller IDs or credentials. A retry's configured limit never supersedes the overall attempt cap. These are **desired rules**, not verified native behavior. Operator text and result actions are likewise draft content until the corresponding native/CRM execution path is implemented.

## Native integration — verified 19 November 2026

Enable the adapter only on VM105 with `OKTELL_SETTINGS_NATIVE=lab-vm105` and `OKTELL_SETTINGS_CREDENTIALS` pointing to a private JSON file containing `login`, `password`, `userId` and the reviewed helper's `helperMd5`. The web service needs narrowly scoped TCP access to VM103:4055. It logs in through its own individual native WebSocket (`json` protocol), requests no telephone, verifies the account identity and helper fingerprint, and logs out. It never uses the working CRM bridge. Never put this file in Git or the runtime artifact.

The adapter creates a native project and stopped task, then applies **task name, native mode, ringing duration, line-count limit and Moscow-time schedule**. The other editor sections remain desired rules only. There is no start operation, source attachment, external-line assignment or client upload. A line-count limit does not assign a line. The original T1 project/source is not reused. The native project initially keeps a stable `LAB_SETTINGS_<draft UUID>` name for reconciliation; the editable task has the user's display name.

Install the custom objects from `scripts/oktell-project-settings.sql` separately in the native `oktell` database after a verified backup. The owner enrollment table is empty by default. Enroll only the isolated settings account, and install the reviewed `scripts/oktell-project-settings-helper.json` service script. The current pinned helper is `CRM ALE41 Refresh Tasks`, ID `5e00bee1-41f3-42f7-9755-a28d6edeb7de`. Its caller ID comes from native function 60, never from the browser. SQL can claim only that owner's empty `LAB_SETTINGS_` projects; registered tasks retain their ownership check. It invokes vendor save procedures, preserves every other task field and the opaque stream, keeps activity zero, rejects attached sources/lines and defers refresh while any native task is active. Do not expose the vendor's general save procedures or arbitrary SQL through the web API.

The helper invokes only the native `reloadtm` task-list refresh, followed by runtime activity readback. It does not reload the PBX, HAL, settings, service or native channel. Native Sunday is 0; the editor uses 7. Predictive sets both ProgressCall and PredictCall. SQL snapshots cover the full task row, stream, operators, schedule and external lines; mismatches reject writes. Operation IDs protect SQL retries, while a durable CRM pending command survives transport loss. Project creation has no native idempotency key: an uncertain create is reconciled by its stable name; an absent/ambiguous result blocks automatic recreation.

Actual native verification created an isolated project/task, changed 50 seconds to 51 and restored 50, and confirmed stopped runtime activity. Retry, stale-snapshot rejection, foreign-task rejection, overlap rollback and 28 schedule periods with Unicode names passed. This proves configuration and stopped-task visibility, not live dialing semantics. No calls were placed. Per-outcome/total attempts, client-local time, operator mapping, queue settings, scripts/results, callbacks and source catalogs still need their own native execution paths and acceptance tests.

Working operators currently use the main CRM and Skorozvon. Do not merge or deploy this branch to main just to test the new surface. Use the checked PR artifact on VM105; keep the flag absent on VM100. Shared host load must remain bounded. The normal main build, blue-green guards and native channel are unchanged.

## Verification

`node --experimental-strip-types tests/oktell-project-settings.mjs` tests validation, T1 preset, conflicts, idempotent retries and transaction rollback. `tests/oktell-project-settings-http.mjs` checks authentication, roles, Origin, payload size, persistence and disabled-mode isolation. The existing `tests/oktell-reset-http.mjs` still exercises the default, disabled behavior.

## Review and confirmation — 20 November 2026

With the lab flag enabled, the existing admin pilot entry opens the project editor. Before applying, the editor compares the five supported fields with the latest native readback, including the full Moscow schedule. Reordering schedule rows does not count as a change. Unsaved drafts, unsupported modes/timezones and an empty schedule show an explanation before submission. Draft-only rules are labelled in each affected section.

An apply response must match every submitted field as well as the stopped/isolated state. A mismatch retains the durable pending operation for reconciliation and never advances the applied revision. This is configuration verification, not a dialing test.

## Manual Excel import — 20 November 2026

The project base tab accepts `.xlsx` (5 MiB, 50,000 rows and 100 columns per sheet, up to 20 sheets). Administrators choose a visible sheet and map phone/name/city columns; the first row is the header. A downloadable blank template is provided. The server normalizes Russian phone numbers, ignores duplicate phones within the file/project and previews new contacts and invalid row numbers before explicit confirmation. Formulas, dates and hyperlinks in selected cells are rejected rather than evaluated. Other columns are not imported. Archive inflation and sparse row/column addresses are bounded before ExcelJS loads the workbook.

Contacts and import receipts are stored in additive, project-scoped CRM tables; ordinary CRM clients/orders, native tables and sources are untouched. Confirmation is bound to the file, mapping and base revision; concurrent imports invalidate stale previews. Contact insertion and receipt/revision updates form one atomic batch. Replaying a completed file/mapping returns the original receipt, including after a lost response or restart. Existing names/cities are never overwritten. The inventory shows 50 contacts and the latest 20 import receipts; the project cap is 100,000 contacts. There is no deletion/replace operation.

This is a real persisted project contact base, not a native upload. Native source delivery/attachment is still unimplemented and clearly labelled in the UI. Import does not activate tasks or make calls. Roles, impersonation, Origin, disabled-mode isolation and binary body limits are checked before processing uploads. Only VM105 receives the feature for testing.
