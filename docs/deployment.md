# Production releases

The source of truth is `timurub02-lang/SM`, branch `main`. Publish changes through GitHub; do not clone dependencies or build inside `/srv/crm/releases`. The package includes the seven existing background synchronization jobs, bundled with their imports, so their systemd services keep working without the source checkout.

The `CRM build and release` workflow builds with Node 24.21.0, the npm lockfile and `CRM_RUNTIME=miran`. It runs authentication, telephony, Oktell and deployment checks against temporary synthetic databases. These checks never place a call. Branches and pull requests build without publishing. A successful main build publishes `crm-<full commit SHA>` with `crm-runtime.tgz` and `SHA256SUMS`. Workflow artifacts expire after seven days; release assets remain in GitHub.

VM100 pulls the public release over HTTPS every five minutes. This uses no GitHub token or inbound SSH access for Actions. Only a release matching the latest main commit is eligible. A local lock serializes installations. Active calls defer installation. Downloads have size and checksum checks; archive traversal, links, environment files and Git metadata are rejected. The service remains on the old version until the new runtime is ready. Its existing environment, database, recordings and Oktell bridge stay outside the runtime package.

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

Admins select a CRM base/sheet/count, review exclusions, then confirm a version-bound batch. Native receipts make uncertain-response retries idempotent. Uploading does not start calls. The runtime supports receipt-bound handoff on a confirmed answer. Install `sql/t1-delivery-source.sql` before attaching the external source through the native client; IDs must not overlap the diagnostic history. Upload alone never attaches the source or starts the task. Cancellation is allowed only while the source is unattached and the task idle, because removing SQL rows does not remove already queued native calls. Reservations remain until confirmed cancellation or explicit completion. Completion requires a paused native task, no sessions, terminal native results for every batch member, and CRM history caught up to the exact bridge checkpoint. A custom attempt limit alone does not release cards. Archived source identities and receipts are retained, so an old response cannot revive a completed batch. An exhausted custom limit with nonterminal native state requires reconciliation; do not bypass this guard. This is not proof of live-call readiness.

Confirmed operator outcomes «Нет ответа» and «Робот-защитник» add membership in the separate CRM follow-up queue, displayed in the delivery dialog. This queue is never automatically uploaded or dialed. It neither moves the client out of their current sheet nor changes ownership. Repeated history synchronization is idempotent. Raw native no-answer events are not equivalent to a selected operator outcome.
