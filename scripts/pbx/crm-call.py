#!/usr/bin/python3
"""AGI writes a durable result; a timer uploads it after hangup, without delaying calls."""
import base64
import hashlib
from datetime import datetime, timezone
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path

ROOT = Path(os.environ.get('CRM_PHONE_SPOOL', '/var/spool/asterisk/crm-calls'))
CONFIG = Path(os.environ.get('CRM_PHONE_CONFIG', '/etc/asterisk/crm-history.json'))

def api(method, call_id='', payload=None, endpoint='', accounts=False):
    config = json.loads(CONFIG.read_text())
    url = config['url']
    if payload and payload.get('event') == 'incoming':
        if not url.endswith('/pbx'):
            raise ValueError('Unexpected PBX result URL')
        url = url[:-4] + '/incoming'
    req = urllib.request.Request(url + ('?accounts=1' if accounts else '?'+urllib.parse.urlencode({'callId':call_id,'endpoint':endpoint}) if call_id else ''),
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
    if mode == 'incoming':
        try:
            unique = env.get('agi_uniqueid', '')
            if not unique:
                return
            call_id = hashlib.sha256(('incoming:' + unique).encode()).hexdigest()[:32]
            payload = {'event': 'incoming', 'id': call_id,
                       'phone': env.get('agi_callerid', '')[:40],
                       'calledNumber': env.get('agi_arg_2', env.get('agi_extension', ''))[:40],
                       'at': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}
            path = ROOT / ('incoming-' + call_id + '.json')
            if not path.exists():
                temp = path.with_suffix('.tmp')
                temp.write_text(json.dumps(payload))
                temp.chmod(0o600)
                with temp.open('rb') as saved:
                    os.fsync(saved.fileno())
                temp.replace(path)
            agi('SET VARIABLE CRM_INCOMING_SAVED 1')
        except Exception:
            print('CRM incoming call could not be saved', file=sys.stderr)
        return
    if not re.fullmatch(r'[a-f0-9]{32}', call_id):
        return
    if mode == 'prepare':
        try:
            data = api('GET', call_id, endpoint=env.get('agi_arg_3', ''))
            caller = data['callerId']
            if caller and not re.fullmatch(r'7\d{10}', caller):
                return
            destination = data['destination']
            if destination != 'echo' and not re.fullmatch(r'7\d{10}', destination):
                return
            agi('SET VARIABLE CRM_DESTINATION '+destination)
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

def classify_remote(path):
    if not path.exists():
        return {'kind': 'unknown', 'reason': 'no_remote_audio', 'method': 'local-asr-v1'}
    try:
        result = subprocess.run(['/opt/sm-call-analysis/bin/python', '/usr/local/lib/sm-crm/crm-call-analysis.py', str(path)],
                                capture_output=True, text=True, timeout=45, check=True)
        return json.loads(result.stdout)
    except Exception:
        return {'kind': 'unknown', 'reason': 'analysis_error', 'method': 'local-asr-v1'}

def upload_one(path):
    try:
        payload = json.loads(path.read_text())
        if not re.fullmatch(r'[a-f0-9]{32}', payload['id']):
            return
        if payload.get('event') == 'incoming':
            if api('POST', payload=payload).get('ok'):
                path.unlink()
            return
        audio = ROOT / (payload['id'] + '.wav')
        remote = ROOT / (payload['id'] + '-remote.wav')
        if payload['answered'] and 'analysis' not in payload:
            payload['analysis'] = classify_remote(remote)
            temp = path.with_suffix('.tmp')
            temp.write_text(json.dumps(payload))
            temp.replace(path)
        if payload['answered'] and audio.exists() and 44 < audio.stat().st_size <= 32*1024*1024:
            payload['audio'] = base64.b64encode(audio.read_bytes()).decode('ascii')
        response = api('POST', payload=payload)
        if response.get('ok'):
            path.unlink()
            audio.unlink(missing_ok=True)
            remote.unlink(missing_ok=True)
    except Exception as error:
        print('CRM call result pending: ' + type(error).__name__, file=sys.stderr)

def upload():
    # Independent calls do not wait for another call's speech analysis or network retry.
    from concurrent.futures import ThreadPoolExecutor
    paths=sorted(ROOT.glob('*.json'), key=lambda p: (not p.name.startswith('incoming-'), p.name))[:100]
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(upload_one, paths))

if __name__ == '__main__':
    os.umask(0o077)
    if '--upload' in sys.argv:
        upload()
    else:
        run_agi()
