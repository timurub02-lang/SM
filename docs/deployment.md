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
