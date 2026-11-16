#!/usr/bin/env python3
"""Verified compaction of cold, unreferenced top-level SQLite checkpoints."""
import argparse
import datetime
import gzip
import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import stat
import tempfile
import time

ROOT = pathlib.Path('/srv/crm/backups')
POLICY = pathlib.Path('/etc/sm-crm-backup-policy.json')
REFERENCE_ROOTS = ('/usr/local/sbin', '/usr/local/bin', '/etc/systemd/system', '/run/systemd/transient',
                   '/etc/cron.d', '/srv/crm/releases', '/var/lib/sm-crm/imports', '/var/lib/sm-crm/ops')
CHUNK = 1024 * 1024


def identity(s):
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns


def in_use(path):
    for proc in pathlib.Path('/proc').glob('[0-9]*'):
        for fd in (proc / 'fd').glob('*'):
            try:
                if fd.resolve() == path:
                    return True
            except FileNotFoundError:
                pass
        try:
            if str(path) in (proc / 'maps').read_text():
                return True
        except FileNotFoundError:
            pass
    return False


def eligible(path, root, cutoff, keep):
    if path.parent != root or path.resolve() != path or path.suffix != '.sqlite':
        return False
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_mtime >= cutoff:
        return False
    if path.name == 'deploy-latest.sqlite' or path.name in keep or pathlib.Path(str(path) + '.keep').exists():
        return False
    for suffix in ('-wal', '-journal'):
        sidecar = pathlib.Path(str(path) + suffix)
        if sidecar.is_symlink() or (sidecar.exists() and sidecar.stat().st_size):
            return False
    return not in_use(path)


def referenced_names(names, roots=REFERENCE_ROOTS):
    found = set()
    for base in roots:
        for folder, dirs, files in os.walk(base, followlinks=False):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', '__pycache__')]
            for name in files:
                p = pathlib.Path(folder) / name
                if p.suffix not in ('', '.py', '.sh', '.js', '.mjs', '.cjs', '.ts', '.service', '.conf'):
                    continue
                if not p.is_file():
                    continue
                with p.open('rb') as source:
                    if b'\0' in source.read(1024):
                        continue
                if p.stat().st_size > 32 * CHUNK:
                    raise RuntimeError('Reference source exceeds scan limit: ' + str(p))
                data = p.read_bytes()
                found.update(name for name in names if name.encode() in data)
    return found


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def compact(path, root, cutoff, keep):
    if not eligible(path, root, cutoff, keep):
        raise RuntimeError('Checkpoint no longer eligible')
    before = path.stat()
    archive = pathlib.Path(str(path) + '.gz')
    receipt = pathlib.Path(str(archive) + '.json')
    if archive.exists() or archive.is_symlink() or receipt.exists() or receipt.is_symlink():
        raise RuntimeError('Existing archive requires inspection: ' + str(archive))
    if shutil.disk_usage(root).free < before.st_size * 2 + 1024**3:
        raise RuntimeError('Insufficient space for verified compaction')
    with tempfile.TemporaryDirectory(prefix='.compact-', dir=root) as folder:
        temp = pathlib.Path(folder)
        packed, restored = temp / 'backup.gz', temp / 'restored.sqlite'
        source_hash = hashlib.sha256()
        with path.open('rb') as source, packed.open('xb') as output:
            if source.read(16) != b'SQLite format 3\x00':
                raise RuntimeError('Not an SQLite database')
            source.seek(0)
            with gzip.GzipFile(filename='', fileobj=output, mode='wb', compresslevel=1, mtime=0) as zipped:
                for chunk in iter(lambda: source.read(CHUNK), b''):
                    source_hash.update(chunk)
                    zipped.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        restored_hash = hashlib.sha256()
        with gzip.open(packed, 'rb') as zipped, restored.open('xb') as output:
            for chunk in iter(lambda: zipped.read(CHUNK), b''):
                restored_hash.update(chunk)
                output.write(chunk)
        if source_hash.digest() != restored_hash.digest() or restored.stat().st_size != before.st_size:
            raise RuntimeError('Restored bytes do not match')
        db = sqlite3.connect(restored.as_uri() + '?mode=ro&immutable=1', uri=True)
        try:
            if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise RuntimeError('Restored SQLite quick_check failed')
        finally:
            db.close()
        if identity(path.stat()) != identity(before) or not eligible(path, root, cutoff, keep):
            raise RuntimeError('Checkpoint changed or became active')
        metadata = {'source': path.name, 'sha256': source_hash.hexdigest(), 'sourceBytes': before.st_size,
                    'sourceMtimeNs': before.st_mtime_ns, 'sourceMode': stat.S_IMODE(before.st_mode),
                    'sourceUid': before.st_uid, 'sourceGid': before.st_gid, 'archiveBytes': packed.stat().st_size,
                    'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'quickCheck': 'ok'}
        meta = temp / 'receipt.json'
        with meta.open('x') as output:
            json.dump(metadata, output)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        # Publish without replacing an existing recovery point; a crash leaves the source intact.
        os.link(packed, archive)
        os.link(meta, receipt)
        fsync_dir(root)
        if identity(path.stat()) != identity(before) or not eligible(path, root, cutoff, keep):
            raise RuntimeError('Checkpoint changed before source removal')
        path.unlink()
        fsync_dir(root)
        return metadata


def run(root, policy, apply=False, reference_roots=REFERENCE_ROOTS):
    if root.resolve() != root or not root.is_dir():
        raise ValueError('Expected a real absolute backup directory')
    hours = policy['archive_after_hours']
    if not isinstance(hours, int) or hours < 48:
        raise ValueError('Keep at least 48 hours of raw checkpoints')
    if not isinstance(policy['keep_names'], list) or any(
            not isinstance(name, str) or pathlib.Path(name).name != name or not name.endswith('.sqlite')
            for name in policy['keep_names']):
        raise ValueError('Keep entries must be a list of SQLite basenames')
    keep = set(policy['keep_names'])
    if policy['warn_backup_bytes'] <= 0 or not 1 <= policy['warn_disk_percent'] <= 100:
        raise ValueError('Invalid monitoring thresholds')
    cutoff = time.time() - hours * 3600
    paths = sorted(root.glob('*.sqlite'), key=lambda p: p.lstat().st_mtime)
    keep |= referenced_names({p.name for p in paths}, reference_roots)
    selected = [p for p in paths if eligible(p, root, cutoff, keep)]
    result = {'mode': 'apply' if apply else 'preview', 'eligible': [p.name for p in selected], 'compacted': []}
    if apply:
        for path in selected:
            result['compacted'].append(compact(path, root, cutoff, keep))
    disk = shutil.disk_usage(root)
    total = sum(p.stat().st_size for p in root.rglob('*') if p.is_file() and not p.is_symlink())
    result.update(backupBytes=total, freeBytes=disk.free,
                  warnings=[message for condition, message in (
                      (total > policy['warn_backup_bytes'], 'Backup size above policy threshold'),
                      (disk.used / (disk.used + disk.free) >= policy['warn_disk_percent'] / 100, 'Disk space above policy threshold')) if condition])
    return result


if __name__ == '__main__':
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Otherwise only print the proposed list')
    args = parser.parse_args()
    os.umask(0o077)
    if POLICY.is_symlink() or POLICY.stat().st_uid != 0 or POLICY.stat().st_mode & 0o022:
        raise RuntimeError('Policy must be root-owned and not writable by others')
    # The backup unit permits writes here; /run/lock is read-only under ProtectSystem=strict.
    fd = os.open(ROOT / '.compaction.lock', os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'a') as lock:
        if not stat.S_ISREG(os.fstat(lock.fileno()).st_mode):
            raise RuntimeError('Expected a regular maintenance lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = run(ROOT, json.loads(POLICY.read_text()), args.apply)
        print(json.dumps(result if not args.apply else {
            'eligibleCount': len(result['eligible']), 'compactedCount': len(result['compacted']),
            'backupBytes': result['backupBytes'], 'freeBytes': result['freeBytes'], 'warnings': result['warnings']}))
        if result['warnings']:
            raise SystemExit(2)
