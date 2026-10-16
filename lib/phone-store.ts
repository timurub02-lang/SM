import {sharedIncomingClientAccess} from './incoming.ts';
import type {ActivityDb} from './activity-store.ts';
import {canOpenClientCard,ownsClient,seesOrder} from './permissions.ts';
import type {Employee,Client,Order} from './crm.ts';
export const callResults={preparing:'Подготовка звонка',dialing:'Идёт вызов',connected:'Соединение установлено',completed:'Соединение состоялось',busy:'Занято',no_answer:'Нет ответа',cancelled:'Отменён до соединения',failed:'Не удалось позвонить',unknown:'Результат не получен от АТС'} as const;
export type CallResult=keyof typeof callResults;
export type PhoneCall={id:string;client_id:string|null;order_id:string|null;actor_id:string;actor_name:string;caller_number:string;started_at:string;answered_at:string|null;ended_at:string|null;status:CallResult;detail:string;duration:number;bill_seconds:number;provider_at:string|null;recording:number;claimed_at:string|null};
export async function initPhone(d:ActivityDb,caller=''){
 await d.batch([
  d.prepare(`CREATE TABLE IF NOT EXISTS phone_calls(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,caller_number TEXT NOT NULL,started_at TEXT NOT NULL,answered_at TEXT,ended_at TEXT,status TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',duration INTEGER NOT NULL DEFAULT 0,bill_seconds INTEGER NOT NULL DEFAULT 0,provider_at TEXT,recording INTEGER NOT NULL DEFAULT 0,claimed_at TEXT)`),
  d.prepare('CREATE INDEX IF NOT EXISTS phone_calls_caller ON phone_calls(caller_number,seq)'),
  d.prepare('CREATE INDEX IF NOT EXISTS phone_calls_client ON phone_calls(client_id,seq)'),d.prepare('CREATE INDEX IF NOT EXISTS phone_calls_order ON phone_calls(order_id,seq)'),
  d.prepare(`CREATE TABLE IF NOT EXISTS phone_call_targets(call_id TEXT PRIMARY KEY REFERENCES phone_calls(id) ON DELETE CASCADE,destination TEXT NOT NULL,sip_user TEXT NOT NULL)`),
  d.prepare(`CREATE TABLE IF NOT EXISTS phone_call_analysis(call_id TEXT PRIMARY KEY REFERENCES phone_calls(id) ON DELETE CASCADE,auto_kind TEXT,auto_reason TEXT,analyzed_at TEXT,manual_kind TEXT,manual_actor TEXT,manual_name TEXT,manual_at TEXT)`),
  d.prepare(`CREATE TABLE IF NOT EXISTS phone_numbers(number TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN ('available','active','completed')),added_at TEXT NOT NULL,activated_at TEXT,completed_at TEXT,exported_at TEXT)`),
  d.prepare(`CREATE TABLE IF NOT EXISTS phone_pool(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL DEFAULT 0,mutation TEXT NOT NULL DEFAULT '')`),d.prepare('INSERT OR IGNORE INTO phone_pool(id) VALUES(1)'),
 ]);
 if(/^7\d{10}$/.test(caller))await d.prepare("INSERT OR IGNORE INTO phone_numbers(number,state,added_at,activated_at) SELECT ?,'active',?,? WHERE NOT EXISTS(SELECT 1 FROM phone_numbers)").bind(caller,new Date().toISOString(),new Date().toISOString()).run();
}
export function normalizeOutgoingNumber(value:string){let n=value.replace(/[\s()+-]/g,'');if(/^8\d{10}$/.test(n))n='7'+n.slice(1);return /^7\d{10}$/.test(n)?n:null;}
export async function replacePhonePool(d:ActivityDb,count:number,version:number,now=new Date().toISOString()){
 if(!Number.isSafeInteger(count)||count<1||count>10000)throw Error('Укажите от 1 до 10 000 номеров');
 const mutation=crypto.randomUUID(),gate="EXISTS(SELECT 1 FROM phone_pool WHERE id=1 AND mutation=?)";
 const r=await d.batch([
  d.prepare("UPDATE phone_pool SET version=version+1,mutation=? WHERE id=1 AND version=? AND (SELECT COUNT(*) FROM phone_numbers WHERE state='available')>=?").bind(mutation,version,count),
  d.prepare(`UPDATE phone_numbers SET state='completed',completed_at=? WHERE state='active' AND ${gate}`).bind(now,mutation),
  d.prepare(`UPDATE phone_numbers SET state='active',activated_at=? WHERE number IN (SELECT number FROM phone_numbers WHERE state='available' ORDER BY added_at,number LIMIT ?) AND ${gate}`).bind(now,count,mutation),
 ]);
 if(!r[0].meta.changes)throw Error('Недостаточно новых номеров или список уже изменился. Обновите данные.');
}
export async function createPhoneCall(d:ActivityDb,input:{id:string;clientId:string|null;orderId:string|null;actor:Employee;echo:boolean;destination?:string;sipUser?:string}){
 const {id,clientId,orderId,actor,echo}=input,now=new Date().toISOString();
 // One INSERT selects the least recently used active number; concurrent calls cannot select stale state.
 const r=await d.prepare(`INSERT INTO phone_calls(id,client_id,order_id,actor_id,actor_name,caller_number,started_at,status)
 SELECT ?,?,?,?,?,${echo?"''":"number"},?,'preparing' ${echo?'':"FROM phone_numbers n WHERE state='active' ORDER BY COALESCE((SELECT MAX(seq) FROM phone_calls c WHERE c.caller_number=n.number),0),number LIMIT 1"}`).bind(id,clientId,orderId,actor.id,actor.name,now).run();
 if(!r.meta.changes)throw Error('Нет включённых исходящих номеров. Настройте интеграцию Билайн АТС.');
 if(input.destination&&input.sipUser)await d.prepare('INSERT INTO phone_call_targets(call_id,destination,sip_user) VALUES(?,?,?)').bind(id,input.destination,input.sipUser).run();
 return d.prepare('SELECT * FROM phone_calls WHERE id=?').bind(id).first() as Promise<PhoneCall>;
}
export async function phoneScope(d:ActivityDb,e:Employee,scope:{clientId?:string;orderId?:string}){
 const staff=(await d.prepare('SELECT data FROM employees').all()).results.map((r:{data:string})=>JSON.parse(r.data) as Employee);
 if(scope.orderId){const row=await d.prepare('SELECT data FROM orders WHERE id=?').bind(scope.orderId).first();if(!row)return false;const order=JSON.parse(row.data);if(e.role==='courier')return seesOrder(e,order,staff)&&!!order.courier?.acceptedAt;return seesOrder(e,order,staff)||await sharedIncomingClientAccess(d,e,order.clientId);}
 if(!scope.clientId||e.role==='courier')return false;
 const row=await d.prepare('SELECT data FROM clients WHERE id=?').bind(scope.clientId).first();if(!row)return false;
 const c:Client=JSON.parse(row.data);if(!canOpenClientCard(e,c))return false;
 if(ownsClient(e,c,staff)||await sharedIncomingClientAccess(d,e,c.id))return true;
 if(['operator','department_head'].includes(e.role))return false;
 const orders=(await d.prepare('SELECT data FROM orders WHERE client_id=?').bind(c.id).all()).results;
 return orders.some((r:{data:string})=>seesOrder(e,JSON.parse(r.data) as Order,staff));
}
export function displayPhoneCall(c:PhoneCall,now=Date.now()){
 const stale=!c.provider_at&&['preparing','dialing','connected'].includes(c.status)&&now-Date.parse(c.started_at)>32*60000;
 return {...c,status:stale?'unknown':c.status,detail:stale?'АТС ещё не передала итог. История обновится после получения результата.':c.detail};
}
