import gzip
import hashlib
import importlib.util
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

repo = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('compaction', repo / 'scripts/compact-crm-backups.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Compaction(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve()
        self.policy = {'archive_after_hours': 48, 'keep_names': [], 'warn_backup_bytes': 40 * 1024**3, 'warn_disk_percent': 100}
        self.fsync = patch.object(module, 'fsync_dir') if os.name == 'nt' else patch.object(module, 'fsync_dir', wraps=module.fsync_dir)
        self.fsync.start()
        self.addCleanup(self.fsync.stop)

    def database(self, name='old.sqlite', age=3 * 86400):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(p)
        db.execute('create table fixture(value text)')
        db.execute('insert into fixture values(?)', ('recovery' * 1000,))
        db.commit()
        db.close()
        os.utime(p, (time.time() - age, time.time() - age))
        return p

    def run_policy(self, apply=False, roots=()):
        return module.run(self.root, self.policy, apply, roots)

    def test_preview_has_no_file_changes(self):
        p = self.database()
        before = p.read_bytes()
        self.assertEqual(self.run_policy()['eligible'], [p.name])
        self.assertEqual(list(self.root.iterdir()), [p])
        self.assertEqual(p.read_bytes(), before)

    def test_archive_round_trip_and_second_run(self):
        p = self.database()
        before = p.read_bytes()
        result = self.run_policy(True)
        self.assertEqual(len(result['compacted']), 1)
        self.assertFalse(p.exists())
        self.assertEqual(gzip.decompress((self.root / 'old.sqlite.gz').read_bytes()), before)
        receipt = json.loads((self.root / 'old.sqlite.gz.json').read_text())
        self.assertEqual(receipt['sha256'], hashlib.sha256(before).hexdigest())
        self.assertEqual(self.run_policy(True)['compacted'], [])

    def test_live_recent_daily_deploy_and_pins_are_preserved(self):
        for name in ['deploy-latest.sqlite', 'daily/old.sqlite', 'migration/old.sqlite', 'pinned.sqlite', 'marker.sqlite']:
            self.database(name)
        self.database('recent.sqlite', 60)
        self.policy['keep_names'] = ['pinned.sqlite']
        (self.root / 'marker.sqlite.keep').touch()
        self.assertEqual(self.run_policy(True)['eligible'], [])

    def test_wal_journal_and_open_files_are_preserved(self):
        p = self.database()
        for suffix in ['-wal', '-journal']:
            side = pathlib.Path(str(p) + suffix)
            side.write_bytes(b'active')
            self.assertEqual(self.run_policy(True)['eligible'], [])
            side.unlink()
        with patch.object(module, 'in_use', return_value=True):
            self.assertEqual(self.run_policy(True)['eligible'], [])
        self.assertTrue(p.exists())

    def test_script_references_protect_checkpoint(self):
        p = self.database()
        source = self.root / 'scripts'
        source.mkdir()
        (source / 'restore.py').write_text("backup = '/srv/crm/backups/old.sqlite'")
        self.assertEqual(self.run_policy(True, (source,))['eligible'], [])
        self.assertTrue(p.exists())

    def test_existing_archive_is_never_overwritten(self):
        p = self.database()
        archive = self.root / 'old.sqlite.gz'
        archive.write_bytes(b'preserve')
        with self.assertRaisesRegex(RuntimeError, 'Existing archive'):
            self.run_policy(True)
        self.assertTrue(p.exists())
        self.assertEqual(archive.read_bytes(), b'preserve')

    def test_corrupt_database_keeps_original(self):
        p = self.database()
        p.write_bytes(b'SQLite format 3\0' + b'broken' * 100)
        os.utime(p, (0, 0))
        before = p.read_bytes()
        with self.assertRaises(sqlite3.DatabaseError):
            self.run_policy(True)
        self.assertEqual(p.read_bytes(), before)
        self.assertFalse((self.root / 'old.sqlite.gz').exists())

    def test_no_space_keeps_original(self):
        p = self.database()
        with patch.object(module.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 0})()):
            with self.assertRaisesRegex(RuntimeError, 'Insufficient space'):
                self.run_policy(True)
        self.assertTrue(p.exists())

    def test_unreadable_process_state_fails_closed(self):
        p = self.database()
        with patch.object(module, 'in_use', side_effect=PermissionError('Cannot inspect processes')):
            with self.assertRaises(PermissionError):
                self.run_policy(True)
        self.assertTrue(p.exists())
        self.assertFalse((self.root / 'old.sqlite.gz').exists())

    def test_source_opened_before_unlink_is_not_removed(self):
        p = self.database()
        with patch.object(module, 'in_use', side_effect=[False, False, False, True]):
            with self.assertRaisesRegex(RuntimeError, 'before source removal'):
                self.run_policy(True)
        self.assertTrue(p.exists())
        self.assertTrue((self.root / 'old.sqlite.gz').exists())

    @unittest.skipIf(os.name == 'nt', 'Linux filesystem links')
    def test_symlinks_and_hardlinks_are_never_removed(self):
        p = self.database('real.sqlite')
        (self.root / 'linked.sqlite').symlink_to(p)
        os.link(p, self.root / 'hard.sqlite')
        self.database('pinned-link.sqlite')
        (self.root / 'pinned-link.sqlite.keep').symlink_to(self.root / 'missing-marker-target')
        self.assertEqual(self.run_policy(True)['eligible'], [])

    def test_threshold_warning_and_policy_validation(self):
        self.database()
        self.policy['warn_backup_bytes'] = 1
        self.assertIn('Backup size above policy threshold', self.run_policy()['warnings'])
        self.policy['archive_after_hours'] = 1
        with self.assertRaises(ValueError):
            self.run_policy(True)

    def test_twelve_hour_boundary_and_legacy_policy(self):
        old = self.database('old.sqlite', 13 * 3600)
        recent = self.database('recent.sqlite', 11 * 3600)
        self.assertEqual(self.run_policy()['eligible'], [])
        self.policy['archive_after_hours'] = 12
        result = self.run_policy(True)
        self.assertEqual(result['eligible'], [old.name])
        self.assertTrue(recent.exists())
        self.assertEqual(len(result['compacted']), 1)
        for invalid in (11, True, 12.5):
            self.policy['archive_after_hours'] = invalid
            with self.assertRaises(ValueError): self.run_policy(True)

    def test_daily_and_hourly_units_have_separate_jobs(self):
        unit = (repo / 'scripts/systemd/sm-crm-backup.service').read_text()
        self.assertIn('ExecStart=/usr/bin/python3 /usr/local/sbin/backup-sm-crm', unit)
        self.assertNotIn('compact-sm-crm-backups', unit)
        unit = (repo / 'scripts/systemd/sm-crm-backup-compact.service').read_text()
        self.assertIn('ExecStart=/usr/bin/python3 /usr/local/sbin/compact-sm-crm-backups --apply', unit)
        self.assertIn('ReadWritePaths=/srv/crm/backups', unit)
        self.assertIn('IOSchedulingClass=idle', unit)
        timer = (repo / 'scripts/systemd/sm-crm-backup-compact.timer').read_text()
        self.assertIn('OnCalendar=hourly', timer)
        self.assertIn('Persistent=true', timer)

    @unittest.skipIf(os.name == 'nt', 'Linux root CLI')
    def test_cli_with_synthetic_policy_and_writable_backup_directory(self):
        self.database()
        policy = self.root / 'policy.json'
        policy.write_text(json.dumps(self.policy))
        os.chmod(policy, 0o600)
        source = (repo / 'scripts/compact-crm-backups.py').read_text()
        source = source.replace("ROOT = pathlib.Path('/srv/crm/backups')", 'ROOT = pathlib.Path('+repr(str(self.root))+')')
        source = source.replace("POLICY = pathlib.Path('/etc/sm-crm-backup-policy.json')", 'POLICY = pathlib.Path('+repr(str(policy))+')')
        script = self.root / 'compactor.py'
        script.write_text(source)
        result = subprocess.run([sys.executable, str(script), '--apply'], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['compactedCount'], 1)
        self.assertTrue((self.root / '.compaction.lock').is_file())


if __name__ == '__main__':
    unittest.main()
