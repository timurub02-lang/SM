# Cold CRM checkpoints (ALE-39)

The daily CRM/bridge backup already retains seven dates. Deployment overwrites
`deploy-latest.sqlite`. Neither owns the historical SQLite checkpoints created
by manual fixes/imports in the top-level backup directory.

`scripts/compact-crm-backups.py` is separate administrator-installed tooling.
Its default mode only prints a proposed list. `--apply` replaces eligible raw
checkpoints with verified gzip files plus JSON receipts. It does not delete
archives or implement off-host storage. These remaining ALE-39 requirements
must not be marked complete based on this compactor alone.

## Selection and preservation

Only ordinary single-link `.sqlite` files immediately under `/srv/crm/backups`
are eligible, after at least 48 hours without changes. Subdirectories, daily,
imports, live databases, recordings, releases and `deploy-latest.sqlite` are
outside this operation. A sibling `<name>.sqlite.keep` marker or a basename
in `keep_names` protects a checkpoint. References in installed release code,
service/cron definitions, administrator and saved import scripts also protect a filename; dynamically constructed names
must be pinned explicitly. Inspect the proposed list before initial activation.

The process refuses nonempty SQLite WAL/journal files, open descriptors/mappings,
symlinks, multiple hard links, pre-existing archive targets and insufficient free
space. Every gzip is fully unpacked, compared against the original SHA-256/size,
and checked with SQLite `quick_check` before the unchanged raw file is removed.
`immutable=1` is used only on the isolated temporary unpacked copy, never on a
live database. See [SQLite URI semantics](https://www.sqlite.org/uri.html).

Receipts record source filename, checksum, size, original metadata and verification
time. A crash between archive publication and source removal can leave both;
the next run refuses to overwrite that archive. Verify both against the receipt
before resolving such a duplicate. Normal repeated runs leave completed archives
alone. Old zero-length WAL/SHM sidecars are not silently removed.

## Policy and installation

The root-owned `/etc/sm-crm-backup-policy.json` must not be group/other writable:

```json
{
  "archive_after_hours": 48,
  "keep_names": [],
  "warn_backup_bytes": 42949672960,
  "warn_disk_percent": 75
}
```

Populate the exclusion list from the site's migration/recovery inventory. These
thresholds warn; they are not a hard deletion budget. Alerts appear in JSON output
and yield exit code 2. Human notification delivery requires a separately verified
monitoring channel. No webhook credentials are accepted or logged by this script.

After successful CI, install the reviewed file separately as
`/usr/local/sbin/compact-sm-crm-backups` (root-owned, executable), create the
protected policy, and run it without `--apply`. Preserve a copy of any replaced
root tooling outside releases. Production runtime files must not be edited.
Install the updated `scripts/systemd/sm-crm-backup.service` only after the script
and policy exist and the preview is accepted. Its `ExecStartPost` performs
compaction after a successful daily backup, using the existing timer and low
CPU/I/O priority. A failed daily backup prevents compaction. A maintenance failure
or threshold warning makes the service fail visibly; the verified daily copies
are still retained. The 30-minute service timeout covers both stages. No new
runtime job or change to package job counting is involved.

Run `systemd-analyze verify` on the installed unit, reload unit definitions without
restarting CRM/bridge, and check both a maintenance run and the next timer trigger.
For rollback, restore the previous unit and reload it; the daily script/timer are
unchanged. Retain archives/receipts created by maintenance. Record installed hashes,
result and service health. External archive expiry is a separate step after
off-host recovery is verified.

For extraction, select the exact gzip/receipt pair, unpack to a new isolated
file, compare size/SHA-256 and run a read-only SQLite check. Do not overwrite
production data. Native state and the restored CRM/bridge history cursors require
separate reconciliation before any restored service can communicate externally.

Tests: `python3 tests/backup-compaction.py` covers preservation, successful and
repeat runs, references, active sidecars, corrupt databases, insufficient space,
archive collision, last-moment activity and Linux links.
