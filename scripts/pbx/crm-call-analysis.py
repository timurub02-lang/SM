#!/usr/bin/python3
"""Conservative, experimental classification of the remote side; never routes calls."""
import json
import re
import sys
import wave
from pathlib import Path

MODEL = Path('/opt/sm-call-analysis/models/vosk-model-small-ru-0.22')

def verdict(kind='unknown', reason='unclear'):
    return {'kind': kind, 'reason': reason, 'method': 'local-asr-v1'}

def classify(segments):
    words = [w for s in segments for w in s.get('result', []) if w.get('conf', 0) >= .7]
    if len(words) < 2:
        return verdict()
    text = ' '.join(w['word'].lower().replace('ё', 'е') for w in words)
    if re.search(r'\bне (?:автоответчик|защитник|голосов\w* помощник)', text):
        return verdict()
    screening = [r'\bзащитник\b', r'(?:голосов\w*|виртуальн\w*|телефонн\w*) (?:ассистент\w*|помощник\w*)',
                 r'представьтесь.{0,50}(?:цель|звон)', r'назовите.{0,40}цель.{0,15}звон',
                 r'(?:секретар\w*|помощник\w*).{0,50}(?:абонент\w*|принима\w* звон)']
    machine = [r'остав\w*.{0,35}сообщен', r'после.{0,25}(?:звуков\w*|тональн\w*).{0,15}сигнал',
               r'голосов\w* почт', r'\bавтоответчик\b']
    if any(re.search(p, text) for p in screening):
        return verdict('screening', 'screening_greeting')
    if any(re.search(p, text) for p in machine):
        return verdict('machine', 'recorded_greeting')
    # shortcut: greetings alone cannot prove a person answered; calibrate on real calls before rollout.
    trusted = [s for s in segments if len(s.get('result', [])) >= 2 and
               sum(w.get('conf', 0) for w in s['result']) / len(s['result']) >= .8]
    if len(trusted) >= 2 and len(words) >= 6 and re.search(r'\b(?:алло|слушаю|говорите|здравствуйте)\b', text):
        return verdict('human', 'speech_turns')
    return verdict()

def analyze(path):
    from vosk import Model, KaldiRecognizer, SetLogLevel
    SetLogLevel(-1)
    with wave.open(str(path), 'rb') as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() not in (8000, 16000):
            return verdict(reason='analysis_error')
        if audio.getnframes() < audio.getframerate():
            return verdict()
        model = Model(str(MODEL))
        recognizer = KaldiRecognizer(model, 16000)
        recognizer.SetWords(True)
        segments = []
        remaining = min(audio.getnframes(), audio.getframerate() * 30)
        rate_state = None
        while remaining > 0:
            count = min(4000, remaining)
            data = audio.readframes(count)
            if not data:
                break
            remaining -= len(data) // 2
            if audio.getframerate() == 8000:
                import audioop  # PBX runs Python 3.12; resample narrowband calls for this 16 kHz model.
                data, rate_state = audioop.ratecv(data, 2, 1, 8000, 16000, rate_state)
            if recognizer.AcceptWaveform(data):
                segments.append(json.loads(recognizer.Result()))
        segments.append(json.loads(recognizer.FinalResult()))
        return classify(segments)

if __name__ == '__main__':
    try:
        print(json.dumps(analyze(Path(sys.argv[1]))))
    except Exception:
        print(json.dumps(verdict(reason='analysis_error')))
