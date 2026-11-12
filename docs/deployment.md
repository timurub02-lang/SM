# Production releases

The source of truth is `timurub02-lang/SM`, branch `main`. Publish changes through GitHub; do not clone dependencies or build inside `/srv/crm/releases`. The package includes the seven existing background synchronization jobs, bundled with their imports, so their systemd services keep working without the source checkout.

The `CRM build and release` workflow builds with Node 24.21.0, the npm lockfile and `CRM_RUNTIME=miran`. It runs authentication, telephony, Oktell and deployment checks against temporary synthetic databases. These checks never place a call. Branches and pull requests build without publishing. A successful main build publishes `crm-<full commit SHA>` with `crm-runtime.tgz` and `SHA256SUMS`. Workflow artifacts expire after seven days; release assets remain in GitHub.

VM100 pulls the release over HTTPS every five minutes. Public repositories work without a token; private repositories require the read-only credential described below. Actions need no inbound SSH access. Only a release matching the latest main commit is eligible. A local lock serializes installations. Active calls defer installation. Downloads have size and checksum checks; archive traversal, links, environment files and Git metadata are rejected. The service remains on the old version until the new runtime is ready. Its existing environment, database, recordings and Oktell bridge stay outside the runtime package.

The installer makes a consistent SQLite backup at `/srv/crm/backups/deploy-latest.sqlite`, atomically changes `/srv/crm/current`, restarts `sm-crm`, and verifies the login HTML and JavaScript. Failure restores the previous runtime. A code rollback does not restore or downgrade the database: schema migrations must remain compatible with the two preceding application versions. A breaking migration needs its own maintenance procedure.

`/srv/crm/releases` contains the active runtime and two previous successful runtimes. Each includes all its runtime dependencies. Immutable browser assets from the preceding two releases are included for tabs opened before publication. Only recognized, marked runtime directories are automatically pruned. Unknown directories are never silently deleted. A legacy manual publication outside this scheme stops automatic deployment until its source is reconciled.

Operations on VM100:

```sh
systemctl start sm-crm-deploy
systemctl status sm-crm-deploy.timer
journalctl -u sm-crm-deploy -n 50
cat /srv/crm/deploy-state.json
touch /srv/crm/deploy-paused
/usr/local/sbin/deploy-sm-crm --rollback saved-<full-commit-sha>
# After resolving the cause and deciding to resume automatic updates:
rm /srv/crm/deploy-paused
```

Choose rollback names exactly from `history` in the state file. A manual rollback pauses automatic deployment so the next check cannot immediately undo it. During the initial migration the legacy source trees and Git metadata are archived outside `releases`; they are recovery material, not installed builds. The current source and recovered Git history are also saved on the administrator's workstation.

The installer and systemd units are installed by an administrator. A repository update does not replace root-owned deployment tooling automatically. Changes to this tooling must be reviewed and installed separately.

The installer reads `/deployment-state` on the private Oktell bridge socket. Its `busy` flag covers all browser sessions, including pending connection changes and unexpired call grants. Install the matching bridge and installer together; a missing or malformed aggregate response stops deployment. These files require separate installation; the CRM runtime release does not update them.

The existing `sync-base` job also imports native T1 call changes using `/pilot-changes?after=<sequence>` on the private bridge socket. Install the matching bridge before deploying a runtime that uses this endpoint. The durable bridge journal retains updates beyond the last 100 calls; CRM advances its saved cursor only after a whole batch is processed. `oktell-history-health` in CRM settings records success or failure separately from base distribution. This job does not initiate calls. A restored bridge journal behind the saved CRM cursor stops synchronization and requires reconciliation; do not reset the cursor blindly or discard the bridge SQLite journal during an update.

CRM base delivery uses the private `/delivery` bridge endpoint and CRM-owned SQL objects from `scripts/oktell-bridge/delivery-schema.sql`. Install the schema, an explicitly configured source binding, and the four narrow `w_crm_delivery_state`, `w_crm_delivery_import`, `w_crm_delivery_cancel`, `w_crm_delivery_complete` allowlist entries before installing the matching bridge (including `delivery-control.cjs`) and runtime. Back up configuration and databases; reload Oktell only after both native tasks and sessions, and all browser phones, are idle. Do not write native A_* tables.

Admins select a CRM base/sheet/count, review exclusions, then confirm a version-bound batch. Native receipts make uncertain-response retries idempotent. Uploading does not start calls. The runtime supports receipt-bound handoff on a confirmed answer. Install `sql/t1-delivery-source.sql` before attaching the external source through the native client; IDs must not overlap the diagnostic history. Upload alone never attaches the source or starts the task. Cancellation is allowed only while the source is unattached and the task idle, because removing SQL rows does not remove already queued native calls. Reservations remain until confirmed cancellation or explicit completion. Completion requires a paused native task, no sessions, terminal native results or three distinct native attempts for every T1 batch member, and CRM history caught up to the exact bridge checkpoint. The combined cap is proven from native history, excluding administrative results and repeated rows for the same call chain. Archived source identities and receipts are retained, so an old response cannot revive a completed batch. This completion path is restricted to the exact T1 external-source binding; its view and custom selector must be installed together. This is not proof of live-call readiness.

Confirmed operator outcomes «Нет ответа» and «Робот-защитник» add membership in the separate CRM follow-up queue, displayed in the delivery dialog. This queue is never automatically uploaded or dialed. It neither moves the client out of their current sheet nor changes ownership. Repeated history synchronization is idempotent. Raw native no-answer events are not equivalent to a selected operator outcome.

## Additional CRM domain

`CRM_ORIGIN` remains an exact trusted origin. `CRM_ADDITIONAL_ORIGINS` is an optional comma-separated list of additional exact origins (no wildcards, paths or trailing slashes); empty entries do not authorize requests. Set it in `/etc/sm-crm.env` for CRM and the separate bridge service environment for browser SIP. The bridge retains `https://crm.smanalytics.ru` as its default origin. Cross-site HTTP mutations remain rejected.

For `https://smcrm.ru`, install its DNS A record, ACME certificate and nginx virtual host separately, including both authenticated WebSocket locations with their exact Origin checks. Keep the old virtual host during migration. Configure `CRM_PUBLIC_URL=https://smcrm.ru` for generated redemption links. Sessions are host-only: staff sign in again on the new domain. Bridge code and its environment need separate installation while operator sessions and calls are idle, as described in `scripts/oktell-bridge/README.md`.

### Temporary LV incoming import

`sync-sk-orders.mjs` also polls LV incoming requests independently of the SK sync. No new timer or runtime entry point is required. It is disabled unless settings `lv-incoming-import` contains `{ "enabled": true, "statusId": 58, "excludeIds": [] }`. It uses the existing `lv-warehouse` credentials for read-only API requests. Set `enabled` to false to stop only this import; do not stop the shared SK timer.

Before enabling after a manual transfer, seed `lv_incoming_imports(id,request_id,at)` from the verified manual transfer journal, including source IDs merged into one request. Otherwise a merged source ID cannot be inferred from the request ID alone. Preserve the ledger when disabling/re-enabling. The importer does not create clients/orders, change ownership, or close/update records in LV. It assigns known clients to their current CRM owner and otherwise uses a uniquely matched LV operator; unassigned requests enter the shared queue. Name/phone/operator conflicts remain in `lv-incoming-health.review` for manual resolution. Existing closed requests are never reopened. `lv-incoming-health` records each pass and sanitized failures.

## Private release access (ALE-35)

Do not change repository visibility until the server-side tooling and recovery path have been verified. Merging this change alone does not install the new root-owned installer. The existing call guard, checksum, backup, health rollback and current-plus-two retention rules still apply. Never enable a disabled synchronization timer as part of this work.

Use a dedicated expiring fine-grained GitHub token owned by an account with access to `timurub02-lang/SM`. Select **only SM**, **Contents: read-only** and the automatic Metadata read permission; grant no write, administration or workflow permission. Do not copy the interactive ChatGPT connector token to production. Track the token owner and expiry in the administrator's credential inventory, not the token value. GitHub documents the required permission and binary API behavior at https://docs.github.com/en/rest/releases/assets#get-a-release-asset.

Install the credential on VM100 as `/etc/sm-crm/github-token`, a regular root-owned file with mode 0600, in a root-owned mode-0700 directory. Transfer its value through an approved secret manager or a protected interactive input; never paste it into a shell command, Git, a ticket, chat, an environment variable value or a log. The installer rejects symlinks, group/other permissions, non-root ownership and malformed tokens. Backups of this directory require equivalent protection.

Keep the default service usable for public releases. Opt in with a separate root-owned systemd drop-in at `/etc/systemd/system/sm-crm-deploy.service.d/github.conf`:

```ini
[Service]
Environment=SM_CRM_GITHUB_TOKEN_FILE=/etc/sm-crm/github-token
```

The environment contains a path only. Once configured, a missing or unsafe credential fails closed; there is no anonymous fallback. Local CRM health checks do not read the credential. Metadata and assets use the repository's GitHub API endpoint; assets request `application/octet-stream`. Authorization is removed on every redirect, HTTPS downgrade and URL credentials are rejected, and transport errors omit response bodies and signed URLs.

### Separate installation and acceptance

1. Record the current installer checksum, service/drop-ins, timer enablement, `deploy-state.json` and `current` target. Preserve a root-only copy of the installed deployment tooling. Create `/srv/crm/deploy-paused` so an automatic run cannot start a new installation during the tooling change; wait for any already-running deploy service to finish.
2. Install the reviewed `scripts/deploy-crm.py` as root-owned mode 0755 at `/usr/local/sbin/deploy-sm-crm`. Install the protected credential and path-only drop-in, then run `systemctl daemon-reload`. Do not restart CRM, the bridge or synchronization services merely to change this tooling.
3. Verify token validity, expiry and repository scope with the credential owner. Use an existing owner-approved private fixture repository, or obtain approval before creating one. Its owner supplies a separate short-lived credential scoped only to that fixture (Contents: read and automatic Metadata read). Never expand the permanent SM credential scope. Import the reviewed installer without running deployment, set its API constant to the fixture endpoint only in that probe process, and use a separate root-owned 0600 credential file. Validate authenticated private metadata and binary download, and verify unauthenticated denial for the same asset API endpoint; never record the credential or signed URL. A public SM asset alone does not prove access to protected assets. Preserve the fixture result and checksums as acceptance evidence. Remove the temporary fixture credential and have its owner revoke it after acceptance.
4. When proceeding with a normal approved deployment, remove the pause only if it was introduced by this maintenance, start `sm-crm-deploy` and let the unchanged active-call guard decide whether installation can proceed. A deferred update is not a successful installation. Check journal, current target, state, public application assets and the affected CRM scenario.
5. Test rollback to an exact retained history entry during an approved idle window using the command above; it must pause automatic updates. Verify application health and state, then explicitly decide whether to resume. Code rollback does not downgrade SQLite. Do not bypass a failed call guard to complete acceptance.
6. Preserve the original timer enablement. Record installed tooling checksum, accepted release SHA, protected-download proof, update/rollback results and credential expiry (never its value) in ALE-35. Until these pass, ALE-35 remains incomplete and ALE-36 remains blocked.

### Rotation and recovery

Create a replacement token with the same narrow scope before expiry. Place it in a new root-owned mode-0600 regular file in the same protected directory; atomically rename it over `github-token`. No CRM restart or systemd reload is needed when the path is unchanged. Verify an authenticated download before revoking the old token. Keep the old token available only in the approved secret manager until the replacement is accepted, then revoke it.

HTTP 401/403/404 or an expired/missing credential must leave the running runtime intact. Pause deployments, repair/rotate the credential and retry. Do not broaden permissions or remove authentication to hide the failure. The current and two retained runtimes remain available for guarded local rollback without GitHub access.

If the new installer itself fails, retain the pause and restore the saved root-owned tooling and drop-in, then daemon-reload. A legacy anonymous installer cannot deploy from a private repository; use local guarded rollback while fixing private access. Do not delete installed runtimes, restore SQLite over live data or change repository visibility as an automatic recovery action.


## CRM refresh, history and local maintenance (November 2026)

The browser opts into `transport=compact-v1`. Legacy GET/POST contracts remain available for open older tabs. The compact transport excludes imported history and raw import columns; history is authorized and paginated independently. Conditional snapshots return changed entities with complete ordered ID lists (including removals); a missing/evicted base returns a full compact snapshot. The cache is scoped to the authenticated account. SSE `/api/crm/changes` publishes only a durable revision, never record identifiers; SQLite triggers also observe external importers. Reconnection, visibility changes and the existing 30-second fallback recover missed notifications. Writes and ordinary form edits do not discard queued refreshes.

`GET /api/crm?list=orders|mine&view=...&page=0` filters and paginates on the server (50 rows), using the same business selectors as the UI. The cross-section working index remains in the compact snapshot for counters, tasks, premiums and bulk printing; this is not SQL LIMIT pagination of every business calculation. The separate base and history endpoints page their own data. Search and bulk operations retain their whole-list scope. Client calendar filters carry the browser's IANA time zone. Scoped order creation/editing reads and reconciles the affected client and their orders, retaining operator-wide sales statistics where the retention rule requires them. Other clients' reminders cannot be pruned by that bounded save.

The new `sync-maintenance.mjs` is an **eighth** packaged job. It applies the existing local deadline, retention and reminder functions; it has no external dispatch/import or telephony work. Additive event/query indexes and revision triggers do not alter stored customer JSON and remain compatible with older runtimes.

Install separately on VM100, in the single coordinated publication window:

1. Record current/state, installer checksum, service drop-ins and all timer enablement. Preserve a root-only copy of the installer and any replaced unit files. Wait for an active deploy to finish. A temporary `deploy-paused` file is only for tooling maintenance; remove it only if this window created it.
2. Install the reviewed `scripts/deploy-crm.py` as `/usr/local/sbin/deploy-sm-crm` (root:root 0755) **before releasing the eight-job package**. It validates exact seven-job legacy and eight-job maintenance manifests, so retained rollback packages remain accepted. Do not change GitHub credential/visibility configuration in this rollout.
3. Install `scripts/systemd/sm-crm-maintenance.service` and `.timer` in `/etc/systemd/system/` (root:root 0644). Install a separate `sm-crm.service.d/maintenance.conf` with `[Service]` and `Environment=CRM_MAINTENANCE_WORKER=1`. Run daemon-reload; the normal guarded deployment will restart CRM. Do not manually modify `current` or restart the bridge.
4. After the new release is installed, enable/start **only** the new maintenance timer. Its ConditionPathExists skips legacy releases. The five-second schedule never overlaps itself. Existing disabled integration timers stay disabled. Verify a successful maintenance run and the aggregate `crm-maintenance-health` timestamp/duration, then check the new web runtime. No customer rows or secrets are needed for health verification.
5. The web runtime skips global maintenance only while the flag is set **and** the last successful worker heartbeat is less than 30 seconds old. Missing, failed or stale health falls back to the legacy reconciliation path; scoped writes always enforce their client/order rules synchronously. A failed worker must be investigated even though this fallback preserves correctness.
6. Verify exact installed SHA, public HTML/JavaScript, two-user refresh, scoped creation/save, history pages, filtering/search, concurrent version conflicts and dirty-form preservation. Record comparable before/after timing and encoded/decoded payload size separately from external import lag. Follow the normal guard and rollback procedure; never bypass a call guard. On rollback, the new timer skips releases without the job and older code ignores the environment flag.

Base administration summaries also use additive expression indexes, initialized by the first authorized base-summary read. They retain the original base/sheet/owner and Moscow-date rules, including legacy source fallback, and update with ordinary client writes/imports. The date is evaluated from an indexed raw timestamp so legacy values cannot make index creation non-deterministic. Initial index construction is a one-time SQLite write; verify the first base read separately from warm timings. Older retained runtimes can ignore these indexes; no unit, installer or job-count change is required.
