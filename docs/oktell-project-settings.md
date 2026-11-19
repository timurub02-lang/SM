# Project settings editor — ALE-41

This branch implements a **draft editor**, not a native task publisher. It is disabled by default. Set `OKTELL_PROJECT_SETTINGS=1` only in the isolated lab to expose `/oktell-projects` to signed-in administrators. Operators, department heads, test-only accounts and impersonated sessions cannot use this API. No new background tasks are installed.

The editor stores named projects, operators, dialing/retry rules, schedules, client-local time, queue limits, operator text, results and callback preferences in two new CRM tables. Saves are version checked and audited atomically. Replaying the same save after a lost response does not create an additional version. Previous versions can be loaded into the form and explicitly saved as a new version. No delete operation is exposed.

The T1 preset is based on the settings recorded on 2026-10-28, not a live read of Skorozvon: predictive, six lines, 50 seconds ringing, three total attempts, six retry outcomes, the recorded weekly schedule and 09:00–20:00 client time. It includes no people, contacts, native IDs, caller IDs or credentials. A retry's configured limit never supersedes the overall attempt cap. These are **desired rules**, not verified native behavior. Operator text and result actions are likewise draft content until the corresponding native/CRM execution path is implemented.

## Native integration still required

The API deliberately reports `native.canApply=false`. There is no apply/start button and no call to the old T1 bridge. Native source selection remains unavailable until an authenticated catalog is implemented. The editor neither opens an individual WebSocket connection nor adds SQL procedures to the allowlist.

To enable actual native configuration, implement and verify the dedicated service-account channel on VM105 → VM103 without moving VM103 ↔ VM100, then add narrow snapshot/save/apply/readback operations. Preserve all opaque TaskProperties.Stream bytes, enforce scope and optimistic concurrency, and prove that saving a stopped task does not activate it. A saved SQL row is not proof that Oktell's task manager applied it. The client-local-time and per-outcome rules require the existing selector logic to be generalized; setting native busy/no-answer fields alone does not implement them.

Working operators currently use the main CRM and Skorozvon. Do not merge or deploy this branch to main just to test the new surface. Use the checked PR artifact on VM105; keep the flag absent on VM100. Shared host load must remain bounded. The normal main build, blue-green guards and native channel are unchanged.

## Verification

`node --experimental-strip-types tests/oktell-project-settings.mjs` tests validation, T1 preset, conflicts, idempotent retries and transaction rollback. `tests/oktell-project-settings-http.mjs` checks authentication, roles, Origin, payload size, persistence and disabled-mode isolation. The existing `tests/oktell-reset-http.mjs` still exercises the default, disabled behavior.
