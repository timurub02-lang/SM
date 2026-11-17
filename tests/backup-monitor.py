import importlib.util
import json
import os
import pathlib
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('monitor', pathlib.Path(__file__).resolve().parents[1] / 'scripts/check-crm-backups.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        (self.root / 'daily').mkdir()
        for name in ('crm', 'pilot'):
            (self.root / 'daily' / ('2026-11-16-' + name + '.sqlite')).write_bytes(b'synthetic')
        self.policy = {'warn_disk_percent': 75, 'warn_backup_bytes': 40 * 1024**3}
        self.now = time.time()

    def unit(self, name):
        return {'LoadState': 'loaded', 'ActiveState': 'active' if name.endswith('.timer') else 'inactive', 'Result': 'success'}

    def inspect(self, unit=None):
        with patch.object(m.shutil, 'disk_usage', return_value=m.shutil._ntuple_diskusage(100, 20, 80)):
            return m.inspect(self.root, self.policy, self.now, unit or self.unit)

    def test_health_thresholds_and_staleness(self):
        self.assertEqual(self.inspect()[0], {})
        self.policy['warn_backup_bytes'] = 1
        self.policy['warn_disk_percent'] = 20
        old = self.root / 'daily/2026-11-16-pilot.sqlite'
        os.utime(old, (self.now - 31 * 3600,) * 2)
        problems, _ = self.inspect()
        self.assertEqual(set(problems), {'backup_size', 'disk', 'stale_pilot'})

    def test_failed_service_and_disabled_timer(self):
        self.assertEqual(set(self.inspect(lambda _: {'LoadState': 'loaded', 'ActiveState': 'failed', 'Result': 'exit-code'})[0]), {'backup_service', 'backup_timer'})
        self.assertEqual(self.inspect(lambda name: self.unit(name) if name.endswith('timer') else {'LoadState': 'loaded', 'ActiveState': 'activating', 'Result': 'exit-code'})[0], {})

    def test_invalid_or_missing_files(self):
        (self.root / 'daily/2026-11-16-crm.sqlite').unlink()
        (self.root / 'daily/2026-11-16-pilot.sqlite').write_bytes(b'')
        (self.root / 'daily/random-crm.sqlite').write_bytes(b'not a dated daily')
        self.assertEqual(set(self.inspect()[0]), {'stale_crm', 'stale_pilot'})
        self.policy['warn_disk_percent'] = float('nan')
        with self.assertRaises(ValueError): self.inspect()

    def test_required_hourly_compaction_health(self):
        self.policy['require_compaction_timer'] = True
        self.assertEqual(self.inspect()[0], {})
        def broken(name):
            return {'LoadState': 'not-found'} if 'compact' in name else self.unit(name)
        self.assertEqual(set(self.inspect(broken)[0]), {'compaction_service', 'compaction_timer'})
        def running(name):
            return {'LoadState': 'loaded', 'ActiveState': 'activating', 'Result': 'exit-code'} if name == 'sm-crm-backup-compact.service' else self.unit(name)
        self.assertEqual(self.inspect(running)[0], {})
        def failed(name):
            return {'LoadState': 'loaded', 'ActiveState': 'failed', 'Result': 'exit-code'} if name == 'sm-crm-backup-compact.service' else self.unit(name)
        self.assertEqual(set(self.inspect(failed)[0]), {'compaction_service'})
        def disabled(name):
            return {'LoadState': 'loaded', 'ActiveState': 'inactive'} if name == 'sm-crm-backup-compact.timer' else self.unit(name)
        self.assertEqual(set(self.inspect(disabled)[0]), {'compaction_timer'})
        self.policy['require_compaction_timer'] = 'yes'
        with self.assertRaises(ValueError): self.inspect()

    def test_repeat_recovery_and_test_do_not_spam(self):
        calls = []
        send = lambda text: calls.append(text) or len(calls)
        self.assertEqual(m.notify({}, {}, 100, send), ({}, False))
        state, sent = m.notify({'disk': '75%'}, {}, 100, send)
        self.assertTrue(sent)
        self.assertFalse(m.notify({'disk': '76%'}, state, 200, send)[1])
        self.assertTrue(m.notify({'disk': '77%'}, state, 100 + m.REPEAT_SECONDS, send)[1])
        recovery, sent = m.notify({}, state, 300, send)
        self.assertTrue(sent)
        self.assertIn('ВОССТАНОВЛЕНО', calls[-1])
        self.assertFalse(m.notify({}, recovery, 400, send)[1])
        self.assertTrue(m.notify({}, recovery, 400, send, test=True)[1])
        self.assertIn('ТЕСТ', calls[-1])

    def test_failed_delivery_preserves_state_and_redacts_token(self):
        previous = {'keys': [], 'sentAt': 1}
        with self.assertRaises(RuntimeError):
            m.notify({'disk': 'full'}, previous, 100, lambda _: (_ for _ in ()).throw(RuntimeError('offline')))
        self.assertEqual(previous, {'keys': [], 'sentAt': 1})
        secret = '123456:' + 'a' * 35
        with patch.object(m.subprocess, 'run', side_effect=RuntimeError(secret)):
            with self.assertRaises(RuntimeError) as error:
                m.send({'token': secret, 'chat_id': -123}, 'test')
        self.assertNotIn(secret, str(error.exception))

    def test_transport_uses_stdin_tls_and_no_redirects(self):
        secret = '123456:' + 'a' * 35
        result = type('Result', (), {'stdout': json.dumps({'ok': True, 'result': {'chat': {'id': -123}, 'message_id': 7}})})()
        with patch.object(m.subprocess, 'run', return_value=result) as call:
            self.assertEqual(m.send({'token': secret, 'chat_id': -123}, 'Проверка\n"test"'), 7)
        args, kwargs = call.call_args
        self.assertNotIn(secret, str(args))
        self.assertIn(secret, kwargs['input'])
        self.assertEqual(args[0][:2], ['curl', '-q'])
        self.assertIn('=https', args[0])
        self.assertFalse(set(args[0]) & {'-L', '--location', '-k', '--insecure'})
        body_line = next(line for line in kwargs['input'].splitlines() if line.startswith('data-binary = '))
        self.assertEqual(json.loads(json.loads(body_line.split(' = ', 1)[1]))['text'], 'Проверка\n"test"')
        result.stdout = '{"ok":true,"result":{"chat":{"id":-999},"message_id":7}}'
        with patch.object(m.subprocess, 'run', return_value=result):
            with self.assertRaises(RuntimeError): m.send({'token': secret, 'chat_id': -123}, 'test')

    def test_atomic_state_and_protected_config(self):
        path = self.root / 'state.json'
        m.save_state(path, {'keys': ['disk'], 'sentAt': 10})
        self.assertEqual(json.loads(path.read_text())['keys'], ['disk'])
        self.assertFalse(list(self.root.glob('.state-*')))
        with patch.object(m.pathlib.Path, 'lstat', return_value=type('Info', (), {'st_mode': 0o100600, 'st_uid': 0})()):
            self.assertEqual(m.protected_json(path, True)['sentAt'], 10)
        with patch.object(m.pathlib.Path, 'lstat', return_value=type('Info', (), {'st_mode': 0o100644, 'st_uid': 0})()):
            with self.assertRaises(ValueError): m.protected_json(path, True)


if __name__ == '__main__': unittest.main()
