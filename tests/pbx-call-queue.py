import importlib.util
import json
import base64
import wave
import io
import os
import tempfile
import subprocess
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('crm_call', Path(__file__).resolve().parents[1] / 'scripts/pbx/crm-call.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as root:
    module.ROOT = Path(root)
    call_id = 'a' * 32
    payload = {'id': call_id, 'started': 100, 'answered': 101, 'ended': 104, 'status': 'ANSWERED', 'cause': '16'}
    result = module.ROOT / (call_id + '.json')
    audio = module.ROOT / (call_id + '.wav')
    result.write_text(json.dumps(payload))
    audio.write_bytes(b'RIFF' + bytes(100))
    remote = module.ROOT / (call_id + '-remote.wav')
    remote.write_bytes(b'RIFF' + bytes(100))
    analysis = {'kind': 'screening', 'reason': 'screening_greeting', 'method': 'local-asr-v1'}
    with patch.object(module, 'api', side_effect=OSError('CRM offline')), patch.object(module, 'classify_remote', return_value=analysis) as classify:
        module.upload()
    assert classify.call_count == 1 and json.loads(result.read_text())['analysis'] == analysis
    assert result.exists() and audio.exists(), 'Keep result and recording until acknowledged'
    sent = []
    def accept(*args, **kwargs):
        sent.append(kwargs['payload'])
        return {'ok': True}
    with patch.object(module, 'api', side_effect=accept), patch.object(module, 'classify_remote', side_effect=AssertionError('Do not analyze twice')):
        module.upload()
        module.upload()
    assert len(sent) == 1 and sent[0]['audio']
    assert sent[0]['analysis'] == analysis
    assert not result.exists() and not audio.exists() and not remote.exists()
    assert module.classify_remote(remote)['reason'] == 'no_remote_audio'
    remote.write_bytes(bytes(100))
    with patch.object(module.subprocess, 'run', side_effect=subprocess.TimeoutExpired('analysis', 45)):
        assert module.classify_remote(remote)['reason'] == 'analysis_error'
    result.write_text(json.dumps({**payload, 'answered': 0, 'status': 'NOANSWER'}))
    with patch.object(module, 'api', side_effect=accept), patch.object(module, 'classify_remote', side_effect=AssertionError('No analysis without answer')):
        module.upload()
    assert 'analysis' not in sent[1] and not remote.exists()
print('PBX queue: offline retry preserves audio, successful upload removes acknowledged files, no replay.')

with tempfile.TemporaryDirectory() as root:
    module.ROOT = Path(root)
    call_id = 'b' * 32
    result = module.ROOT / (call_id + '.json')
    audio = module.ROOT / (call_id + '.wav')
    result.write_text(json.dumps({**payload, 'id': call_id, 'analysis': analysis}))
    with audio.open('wb') as large:
        large.truncate(32*1024*1024 + 1)
    with patch.object(module, 'api', return_value={'ok': True}) as send:
        module.upload()
        module.upload()
    assert send.call_count == 1 and 'audio' not in send.call_args.kwargs['payload']
    assert audio.exists() and result.with_suffix('.deferred').exists()
    assert not result.exists(), 'Oversized audio must not block or repeat the normal queue'
print('Oversized recording retained with recovery metadata; metadata acknowledgement never deletes unsent audio.')

with tempfile.TemporaryDirectory() as root:
    module.ROOT = Path(root)
    env = 'agi_arg_1: incoming\nagi_arg_2: 79000000000\nagi_extension: s\nagi_uniqueid: 123456.789\nagi_callerid: +79990000001\n\n'
    with patch.object(module.sys, 'stdin', io.StringIO(env)), patch.object(module, 'agi') as agi:
        module.run_agi()
    agi.assert_called_once_with('SET VARIABLE CRM_INCOMING_SAVED 1')
    paths = list(module.ROOT.glob('incoming-*.json'))
    assert len(paths) == 1
    event = json.loads(paths[0].read_text())
    assert event['phone'] == '+79990000001' and event['calledNumber'] == '79000000000'
    with patch.object(module.sys, 'stdin', io.StringIO(env)), patch.object(module, 'agi'):
        module.run_agi()
    assert json.loads(paths[0].read_text()) == event, 'Replay preserves original event time'
    with patch.object(module, 'api', side_effect=OSError('offline')):
        module.upload()
    assert paths[0].exists()
    with patch.object(module, 'api', return_value={'ok': True}) as send, patch.object(module, 'classify_remote', side_effect=AssertionError('Incoming has no audio analysis')):
        module.upload()
    assert not paths[0].exists() and send.call_args.kwargs['payload'] == event
    module.ROOT = Path(root) / 'missing-directory'
    with patch.object(module.sys, 'stdin', io.StringIO(env)), patch.object(module, 'agi') as agi:
        module.run_agi()
    assert not agi.called, 'Never promise registration if durable write failed'
print('Incoming AGI: durable capture, original DID, retry deduplication, offline retention, no false success passed.')

# A batch of 25 completed calls is uploaded without losing or duplicating results.
with tempfile.TemporaryDirectory() as root:
    module.ROOT=Path(root)
    ids={format(n,'032x') for n in range(25)}
    for call_id in ids:
        (module.ROOT/(call_id+'.json')).write_text(json.dumps({'id':call_id,'answered':0}))
    with patch.object(module,'api',return_value={'ok':True}) as send:
        module.upload()
        assert {c.kwargs['payload']['id'] for c in send.call_args_list}==ids
    assert not list(module.ROOT.glob('*.json'))
print('25-call queue batch passed.')

# The identity comes from the authenticated PJSIP endpoint, never a browser header.
with patch.object(module.sys,'stdin',io.StringIO('agi_arg_1: prepare\nagi_arg_2: '+'a'*32+'\nagi_arg_3: crm-personal\n\n')), patch.object(module,'api',return_value={'callerId':'79000000000','destination':'79990000001'}) as api, patch.object(module,'agi') as agi:
    module.run_agi()
    api.assert_called_once_with('GET','a'*32,endpoint='crm-personal')
    assert any(c.args[0]=='SET VARIABLE CRM_DESTINATION 79990000001' for c in agi.call_args_list)
print('AGI personal endpoint and destination passed.')

for decision in ('allow', 'challenge', 'block'):
    env = 'agi_arg_1: incoming-guard\nagi_arg_2: 79000000000\nagi_uniqueid: 123.456\nagi_callerid: +79990000001\n\n'
    with patch.object(module.sys, 'stdin', io.StringIO(env)), patch.object(module, 'api', return_value={'decision':decision}) as api, patch.object(module, 'agi') as agi:
        module.run_agi()
        agi.assert_called_once_with('SET VARIABLE CRM_INCOMING_GATE '+decision)
        assert api.call_args.kwargs['payload']['phase'] == 'guard'
with patch.object(module.sys, 'stdin', io.StringIO(env)), patch.object(module, 'api', side_effect=OSError('offline')), patch.object(module, 'agi') as agi:
    module.run_agi()
    agi.assert_called_once_with('SET VARIABLE CRM_INCOMING_GATE challenge')
with tempfile.TemporaryDirectory() as root:
    module.ROOT = Path(root)
    env = 'agi_arg_1: incoming\nagi_arg_2: 79000000000\nagi_arg_3: failed\nagi_uniqueid: 456.789\nagi_callerid: +79990000001\n\n'
    with patch.object(module.sys, 'stdin', io.StringIO(env)), patch.object(module, 'agi'):
        module.run_agi()
    assert json.loads(next(module.ROOT.glob('incoming-*.json')).read_text())['screening'] == 'failed'
print('Incoming screening: allow/challenge/block, offline fallback and failed challenge capture passed.')

# Carrier audio must be closed and acknowledged before removing either feed.
with tempfile.TemporaryDirectory() as root:
    module.ROOT=Path(root)
    call_id='c'*32
    result=module.ROOT/(call_id+'.json')
    browser=module.ROOT/(call_id+'.wav')
    line=module.ROOT/(call_id+'-line.wav')
    client=module.ROOT/(call_id+'-line-client.wav')
    staff=module.ROOT/(call_id+'-line-staff.wav')
    marker=module.ROOT/(call_id+'-line.ready')
    result.write_text(json.dumps({**payload,'id':call_id}))
    browser.write_bytes(b'RIFF'+bytes(100))
    for path,value in [(line,300),(client,100),(staff,200)]:
        with wave.open(str(path),'wb') as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(8000)
            w.writeframes(value.to_bytes(2,'little',signed=True)*160)
    with patch.object(module,'api') as send,patch.object(module,'classify_remote') as classify:
        module.upload_one(result)
    send.assert_not_called();classify.assert_not_called()
    assert result.exists() and line.exists(),'Never upload or delete an open recording'
    with patch.object(module.sys,'stdin',io.StringIO('agi_arg_1: line-ready\nagi_arg_2: '+call_id+'\n\n')):
        module.run_agi()
    assert marker.exists()
    expected=line.read_bytes()
    with patch.object(module,'api',side_effect=OSError('offline')),patch.object(module,'classify_remote',return_value=analysis) as classify:
        module.upload_one(result)
    classify.assert_called_once_with(client)
    assert all(p.exists() for p in [result,browser,line,client,staff,marker])
    with patch.object(module,'api',return_value={'ok':True}) as send,patch.object(module,'classify_remote',side_effect=AssertionError('No duplicate analysis')):
        module.upload_one(result)
    assert base64.b64decode(send.call_args.kwargs['payload']['audio'])==expected
    assert not any(p.exists() for p in [result,browser,line,client,staff,marker])
    result.write_text(json.dumps({**payload,'id':call_id}))
    line.write_bytes(b'invalid');marker.touch()
    with patch.object(module,'api') as send,patch.object(module,'classify_remote'):
        module.upload_one(result)
    send.assert_not_called()
    assert line.exists() and result.exists()
    with wave.open(str(line),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(8000);w.writeframes(b'')
    with patch.object(module,'api',return_value={'ok':True}) as send,patch.object(module,'classify_remote',return_value=analysis):
        module.upload_one(result)
    assert 'audio' not in send.call_args.kwargs['payload'],'An empty short call still uploads its outcome without fake audio'
    assert not result.exists() and not line.exists() and not marker.exists()

    with patch.object(module.sys,'stdin',io.StringIO('agi_arg_1: line-ready\nagi_arg_2: ../../bad\n\n')):
        module.run_agi()
    assert not marker.exists(),'Completion requires a valid call ID'
print('Carrier recording: close-before-upload, exact audio, analysis feed, retry retention and cleanup passed.')
plan=(Path(__file__).resolve().parents[1]/'scripts/pbx/crm-browser-dialplan.conf').read_text()
answered=plan.split('[crm-call-answered]')[1].split('[crm-call-ended]')[0]
assert 'MASTER_CHANNEL(CRM_CALL_ID)' in answered and 'crm-line-recording-ended' in answered
assert '-line.wav,br(' in answered and '-line-client.wav)t(' in answered and '-line-staff.wav)' in answered
assert answered.index('StopMixMonitor()')<answered.index('crm-call.py,line-ready')
