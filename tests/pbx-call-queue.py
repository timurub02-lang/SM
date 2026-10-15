import importlib.util
import json
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
