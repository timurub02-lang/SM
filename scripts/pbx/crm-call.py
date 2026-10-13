#!/usr/bin/python3
"""AGI writes a durable result; a timer uploads it after hangup, without delaying calls."""
import base64
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get('CRM_PHONE_SPOOL', '/var/spool/asterisk/crm-calls'))
CONFIG = Path(os.environ.get('CRM_PHONE_CONFIG', '/etc/asterisk/crm-history.json'))

def api(method, call_id='', payload=None):
    config = json.loads(CONFIG.read_text())
    req = urllib.request.Request(config['url'] + ('?callId=' + call_id if call_id else ''),
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'X-CRM-PBX-Key': config['key'], 'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read())

def agi(command):
    print(command, flush=True)
    response = sys.stdin.readline().strip()
    match = re.match(r'200 result=1 \((.*)\)$', response)
    return match.group(1) if match else ''

def run_agi():
    env = {}
    for line in sys.stdin:
        if not line.strip():
            break
        key, _, value = line.rstrip().partition(': ')
        env[key] = value
    mode, call_id = env.get('agi_arg_1', ''), env.get('agi_arg_2', '')
    if not re.fullmatch(r'[a-f0-9]{32}', call_id):
        return
    if mode == 'prepare':
        try:
            data = api('GET', call_id)
            caller = data['callerId']
            if caller and not re.fullmatch(r'7\d{10}', caller):
                return
            agi('SET VARIABLE CRM_OUTBOUND "' + caller + '"')
            agi('SET VARIABLE CRM_CALL_OK 1')
        except Exception:
            print('CRM call preparation unavailable', file=sys.stderr)
    elif mode == 'finish':
        get = lambda key: agi('GET VARIABLE ' + key)
        started, answered = get('CRM_STARTED'), get('CRM_ANSWERED')
        status, cause = get('DIALSTATUS'), get('HANGUPCAUSE')
        payload = {'id': call_id, 'started': int(started or time.time()), 'answered': int(answered or 0),
                   'ended': int(time.time()), 'status': status, 'cause': cause}
        path = ROOT / (call_id + '.json')
        temp = path.with_suffix('.tmp')
        temp.write_text(json.dumps(payload))
        temp.chmod(0o600)
        temp.replace(path)

def upload():
    # Failed uploads remain queued, including their audio, until CRM acknowledges them.
    for path in sorted(ROOT.glob('*.json'))[:50]:
        try:
            payload = json.loads(path.read_text())
            if not re.fullmatch(r'[a-f0-9]{32}', payload['id']):
                continue
            audio = ROOT / (payload['id'] + '.wav')
            if payload['answered'] and audio.exists() and 44 < audio.stat().st_size <= 4*1024*1024:
                payload['audio'] = base64.b64encode(audio.read_bytes()).decode('ascii')
            response = api('POST', payload=payload)
            if response.get('ok'):
                path.unlink()
                audio.unlink(missing_ok=True)
        except Exception as error:
            print('CRM call result pending: ' + type(error).__name__, file=sys.stderr)

if __name__ == '__main__':
    os.umask(0o077)
    if '--upload' in sys.argv:
        upload()
    else:
        run_agi()
