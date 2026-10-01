"""Run against the local demo only: python3 tests/smoke.py. No live integrations."""
import json, urllib.request, urllib.error, http.cookiejar, uuid
base='http://localhost:5173'
jar=http.cookiejar.CookieJar(); session=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
session.open(base+'/signin-with-chatgpt?return_to=/').read()
def get():
 return json.load(session.open(base+'/api/crm'))
def post(action, fail=False, **data):
 r=urllib.request.Request(base+'/api/crm',data=json.dumps(dict(action=action,actorId='anna',**data)).encode(),headers={'Content-Type':'application/json'})
 try:
  response=json.load(session.open(r))
  assert not fail, f'{action} should fail'
  return response['state']
 except urllib.error.HTTPError as e:
  error=json.load(e)
  assert fail,(action,error)
  return error
suffix=str(uuid.uuid4().int)[-9:]; phone='+79'+suffix
s=post('createClient',client={'name':'Тест сценария '+suffix,'phone':phone,'city':'Тест','address':'Тестовая улица, 1','owner':'anna'})
c=next(c for c in s['clients'] if c['phone']==phone)
post('createClient',fail=True,client={'name':'Дубль','phone':phone})
s=post('createOrder',clientId=c['id'],items=[],comment='Smoke test')
o=next(o for o in s['orders'] if o['clientId']==c['id'])
post('transition',fail=True,id=o['id'],version=o['version'],to='confirm')
s=post('updateOrder',id=o['id'],version=o['version'],items=[{'name':'Тестовый товар','quantity':2,'price':100}],comment='Проверено')
def order(): return next(x for x in s['orders'] if x['id']==o['id'])
stale=o['version']; o=order()
before=len(s['events'])
post('comment',fail=True,id=o['id'],version=stale,text='Конфликт')
assert len(get()['events'])==before, 'stale update must not add history'
def move(to,reason=''):
 global s,o
 s=post('transition',id=o['id'],version=o['version'],to=to,reason=reason);o=order();assert o['status']==to
move('confirm')
post('contact',fail=True,id=o['id'],version=o['version'],contact='callback',reason='Неудобно')
s=post('contact',id=o['id'],version=o['version'],contact='missed',reason='Автоответчик');o=order();assert o['contact']=='missed' and o['due']==''
post('transition',fail=True,id=o['id'],version=o['version'],to='rework',reason='')
move('rework','Недозвон');move('confirm');assert o['round']==2
move('check');move('extra');assert o['extra']
move('rework','Нужны уточнения')
post('transition',fail=True,id=o['id'],version=o['version'],to='confirm')
move('extra');assert o['round']==3 and o['extra']
move('packing');move('phone')
post('transition',fail=True,id=o['id'],version=o['version'],to='shipping')
assert next(x for x in get()['orders'] if x['id']==o['id'])['status']=='phone'
count=len(s['clients']);s=post('import',rows=[{'name':'Дубль','phone':phone},{'name':'Дубль','phone':phone}]);assert len(s['clients'])==count
assert any(e['orderId']==o['id'] and 'Автоответчик' in e['text'] for e in s['events'])
print('PASS: persistence, duplicates, empty basket, invalid transitions, missed call, required callback time, repeat/extra confirmation, immutable history on conflict, integration boundary.')
