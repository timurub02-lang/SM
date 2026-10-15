#!/usr/bin/python3
"""Dedicated delivery numbers never enter the ordinary callback queue while assigned."""
import hashlib, json, os, re, sys, urllib.request
from pathlib import Path
CONFIG=Path(os.environ.get('CRM_PHONE_CONFIG','/etc/asterisk/crm-history.json'))
CACHE=Path(os.environ.get('CRM_REPLACEMENT_CACHE','/var/spool/asterisk/crm-calls/replacement-pool.cache'))
def api(payload=None):
    config=json.loads(CONFIG.read_text())
    if not config['url'].endswith('/pbx'): raise ValueError('Invalid API URL')
    req=urllib.request.Request(config['url'][:-4]+'/replacement',data=None if payload is None else json.dumps(payload).encode(),headers={'X-CRM-PBX-Key':config['key'],'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=8) as r: return json.load(r)
def sync():
    data=api()
    if not isinstance(data.get('numbers'),list) or any(not re.fullmatch(r'7\d{10}',n) for n in data['numbers']): raise ValueError('Invalid pool')
    temp=CACHE.with_suffix('.tmp');temp.write_text(json.dumps(data));temp.chmod(0o600);temp.replace(CACHE)
    api({'action':'heartbeat','numbers':data['numbers']})
def agi(command):
    print(command,flush=True);sys.stdin.readline()
def run():
    env={}
    for line in sys.stdin:
        if not line.strip(): break
        key,_,value=line.rstrip().partition(': ');env[key]=value
    number=env.get('agi_arg_1','').lstrip('+')
    if re.fullmatch(r'\d{10}',number): number='7'+number
    if re.fullmatch(r'8\d{10}',number): number='7'+number[1:]
    if not CACHE.exists(): return
    if number not in json.loads(CACHE.read_text()).get('numbers',[]): return
    agi('SET VARIABLE CRM_MASK_MODE error')
    try:
        call_id=hashlib.sha256(('replacement:'+env.get('agi_uniqueid','')).encode()).hexdigest()[:32]
        result=api({'number':number,'caller':env.get('agi_callerid','')[:40],'callId':call_id})
        mode=result['mode']
        if mode in ('free','regular'): agi('SET VARIABLE CRM_MASK_MODE regular')
        elif mode=='wait': agi('SET VARIABLE CRM_MASK_MODE wait')
        elif mode=='connect' and re.fullmatch(r'7\d{10}',result['destination']) and result['callerId']==number:
            agi('SET VARIABLE CRM_MASK_DEST '+result['destination'])
            agi('SET VARIABLE CRM_MASK_CALLER '+number)
            agi('SET VARIABLE CRM_CALL_ID '+call_id)
            agi('SET VARIABLE CRM_REPLACEMENT 1')
            agi('SET VARIABLE CRM_MASK_MODE connect')
    except Exception: print('Delivery number route unavailable',file=sys.stderr)
if __name__=='__main__':
    os.umask(0o077)
    if '--sync' in sys.argv: sync()
    else: run()
