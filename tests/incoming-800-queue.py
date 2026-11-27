"""Synthetic queue/HTTP/AGI tests. No Asterisk or production credentials."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/pbx/crm-incoming-800.py'
spec = importlib.util.spec_from_file_location('incoming800', SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'queue.sqlite'
        self.db = m.connect(self.path)
        self.cfg = dict(node='fixture-pbx', routes=dict(megafon='+78000000001'), key='synthetic-key-800-12345678901234567890')
        self.cfg_path = Path(self.tmp.name) / 'config.json'

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def enqueue(self, unique='call.1', phone='8 (999) 000-00-01'):
        return m.capture(self.db, self.cfg, 'megafon', unique, phone)

    def due(self):
        with self.db:
            self.db.execute('UPDATE queue SET next_attempt=0,lease_until=0')

    def row(self):
        return self.db.execute('SELECT * FROM queue').fetchone()

    def test_capture_and_restart(self):
        identity = self.enqueue()
        original = self.row()['payload']
        self.db.close()
        self.db = m.connect(self.path)
        self.assertEqual(identity, self.enqueue())
        self.assertEqual(original, self.row()['payload'])
        self.assertEqual(json.loads(original)['phone'], '+79990000001')
        with self.assertRaises(ValueError):
            self.enqueue(phone='+79990000002')
        with self.assertRaises(ValueError):
            m.capture(self.db, self.cfg, 'untrusted', 'evil', '+79990000001')
        output = io.StringIO()
        m.agi(self.db, self.cfg, 'megafon', io.StringIO('agi_uniqueid: early.hangup\nagi_callerid: anonymous\n\n'), output)
        self.assertEqual(output.getvalue(), 'SET VARIABLE CRM800_SAVED "1"\n')
        self.assertEqual(self.db.execute('SELECT count(*) FROM queue').fetchone()[0], 2)
        report = json.dumps(m.status(self.db))
        self.assertNotIn('7999', report)
        self.assertNotIn(self.cfg['key'], report)

    def test_disk_failure_never_promises_callback(self):
        self.db.execute("CREATE TRIGGER failure BEFORE INSERT ON queue BEGIN SELECT RAISE(ABORT,'disk failure fixture'); END")
        output = io.StringIO()
        with self.assertRaises(Exception):
            m.agi(self.db, self.cfg, 'megafon', io.StringIO('agi_uniqueid: failed\n\n'), output)
        self.assertEqual(output.getvalue(), '')
        self.assertEqual(self.db.execute('SELECT count(*) FROM queue').fetchone()[0], 0)

    def test_delivery_retries_receipts_and_leases(self):
        identity = self.enqueue()
        mode, received = ['lost-ack'], []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                payload = self.rfile.read(int(self.headers['Content-Length']))
                received.append(payload)
                if mode[0] == 'lost-ack':
                    self.connection.close()
                    return
                if mode[0] == 'redirect':
                    self.send_response(302)
                    self.send_header('Location', '/credential-must-not-follow')
                    self.end_headers()
                    return
                if mode[0].isdigit():
                    self.send_response(int(mode[0]))
                    self.end_headers()
                    return
                data = dict(ok=True, eventId=identity if mode[0] != 'wrong-id' else 'other', disposition='accepted', requestId='fixture-request')
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.cfg['url'] = 'http://127.0.0.1:%s/api/telephony/incoming-800' % server.server_port
        try:
            self.assertTrue(m.deliver(self.db, self.cfg))
            self.assertEqual(self.row()['state'], 'pending')
            self.assertFalse(m.deliver(self.db, self.cfg))  # backoff
            for failure in ('503', '403', '404', 'wrong-id', 'redirect'):
                mode[0] = failure
                self.due()
                m.deliver(self.db, self.cfg)
                self.assertEqual(self.row()['state'], 'pending')
            # A competing worker cannot claim a current lease; after a crash it expires.
            self.due()
            with self.db:
                self.db.execute('UPDATE queue SET lease_until=?', (time.time()+30,))
            self.assertFalse(m.deliver(self.db, self.cfg))
            self.due()
            mode[0] = 'ok'
            self.cfg_path.write_text(json.dumps(self.cfg))
            subprocess.run([sys.executable, str(SCRIPT), 'once', '--config', str(self.cfg_path), '--db', str(self.path)], check=True)
            self.assertEqual(self.row()['state'], 'accepted')
            self.assertEqual(json.loads(self.row()['receipt'])['eventId'], identity)
            self.assertFalse(m.deliver(self.db, self.cfg))
            self.assertTrue(all(p == received[0] for p in received))
            self.enqueue('bad')
            mode[0] = '409'
            m.deliver(self.db, self.cfg)
            self.assertEqual(m.status(self.db)['counts']['quarantine'], 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_transport_config(self):
        for url in ('http://public.example/api/telephony/incoming-800', 'https://example.invalid/other', 'https://user:password@example.invalid/api/telephony/incoming-800'):
            with self.assertRaises(ValueError):
                m.validate_delivery(dict(self.cfg, url=url))


if __name__ == '__main__':
    unittest.main()
