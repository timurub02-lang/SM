import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('analysis', Path(__file__).resolve().parents[1] / 'scripts/pbx/crm-call-analysis.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def segment(text, confidence=.95):
    return {'result': [{'word': w, 'conf': confidence} for w in text.split()]}
assert module.classify([segment('здравствуйте я защитник мтс представьтесь')])['kind'] == 'screening'
assert module.classify([segment('вас приветствует голосовой помощник назовите цель звонка')])['kind'] == 'screening'
assert module.classify([segment('оставьте сообщение после звукового сигнала')])['kind'] == 'machine'
assert module.classify([segment('вас приветствует голосовая почта')])['kind'] == 'machine'
assert module.classify([segment('алло здравствуйте кто это'), segment('да я вас слушаю говорите')])['kind'] == 'human'
assert module.classify([segment('алло здравствуйте')])['kind'] == 'unknown'
assert module.classify([segment('я не автоответчик а человек')])['kind'] == 'unknown'
assert module.classify([segment('голосовой помощник защитник', .2)])['kind'] == 'unknown'
assert module.classify([])['kind'] == 'unknown'
assert module.classify([segment('пришлите пожалуйста сообщение на телефон')])['kind'] == 'unknown'
print('Experimental classifier: screening, voicemail, multiple speech turns, low confidence, short greeting and ambiguity passed.')
