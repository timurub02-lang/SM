import importlib.util
import json
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
