import gzip
import hashlib
import importlib.util
import json
import os
import pathlib
import sqlite3
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
        self.assertEqual(self.run_policy(True)['eligible'], [])

    def test_threshold_warning_and_policy_validation(self):
        self.database()
        self.policy['warn_backup_bytes'] = 1
        self.assertIn('Backup size above policy threshold', self.run_policy()['warnings'])
        self.policy['archive_after_hours'] = 1
        with self.assertRaises(ValueError):
            self.run_policy(True)

    def test_existing_daily_unit_orders_compaction_after_backup(self):
        unit = (repo / 'scripts/systemd/sm-crm-backup.service').read_text()
        self.assertIn('ExecStart=/usr/bin/python3 /usr/local/sbin/backup-sm-crm', unit)
        self.assertIn('ExecStartPost=/usr/bin/python3 /usr/local/sbin/compact-sm-crm-backups --apply', unit)
        self.assertIn('IOSchedulingClass=idle', unit)


if __name__ == '__main__':
    unittest.main()
