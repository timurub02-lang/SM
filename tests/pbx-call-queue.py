import importlib.util
import json
import os
import tempfile
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
    with patch.object(module, 'api', side_effect=OSError('CRM offline')):
        module.upload()
    assert result.exists() and audio.exists(), 'Keep result and recording until acknowledged'
    sent = []
    def accept(*args, **kwargs):
        sent.append(kwargs['payload'])
        return {'ok': True}
    with patch.object(module, 'api', side_effect=accept):
        module.upload()
        module.upload()
    assert len(sent) == 1 and sent[0]['audio']
    assert not result.exists() and not audio.exists()
print('PBX queue: offline retry preserves audio, successful upload removes acknowledged files, no replay.')
