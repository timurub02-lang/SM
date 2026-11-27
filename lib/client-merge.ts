import {createHash,randomUUID} from 'node:crypto';
import type {ActivityDb as Db} from './activity-store.ts';
import {normalizePhone,type Client,type Order} from './crm.ts';

const historical=new Set(['base_import_members','base_import_snapshots','client_merge_audit']);
const supported=new Set(['orders','events','client_phone_index','base_dispatch_items','phone_calls','incoming_calls','replacement_assignments','client_reminders','client_work','base_movements','oktell_delivery_items','oktell_delivery_calls','oktell_followup','cdek_history_recovery','crmcalls_items']);
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const json=JSON.stringify;
export async function mergePreview(d:Db,ids:string[]){
 if(ids.length<2||ids.length>10||new Set(ids).size!==ids.length)throw Error('Выберите от 2 до 10 разных карточек');
 const rows=(await d.prepare('SELECT id,data,version FROM clients WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id').bind(json(ids)).all()).results as {id:string;data:string;version:number}[];
 if(rows.length!==ids.length)throw Error('Карточка уже изменена или объединена. Повторите поиск');
 const clients=rows.map(r=>({...JSON.parse(r.data),version:r.version}) as Client);
 const orderRows=(await d.prepare('SELECT id,data,version FROM orders WHERE client_id IN (SELECT value FROM json_each(?)) ORDER BY id').bind(json(ids)).all()).results as {id:string;data:string;version:number}[];
 const orders=orderRows.map(r=>({...JSON.parse(r.data),version:r.version}) as Order);
 const staff=(await d.prepare('SELECT id,data FROM employees').all()).results as {id:string;data:string}[];
 const owners=staff.map(r=>({id:r.id,...JSON.parse(r.data)})).filter(e=>clients.some(c=>c.owner===e.id)).map(e=>({id:e.id,name:e.name,login:e.login,role:e.role}));
 const revision=createHash('sha256').update(json({rows,orderRows})).digest('hex');
 return {clients,orders,owners,revision};
}
export async function mergeClients(d:Db,input:{ids:string[];ownerClientId:string;phone:string;revision:string},actorId:string){
 const p=await mergePreview(d,input.ids);
 if(p.revision!==input.revision)throw Error('Данные изменились. Проверьте карточки ещё раз');
 const source=p.clients.find(c=>c.id===input.ownerClientId);if(!source)throw Error('Выберите карточку, чей владелец и срок сохраняются');
 if(source.owner&&!p.owners.some(e=>e.id===source.owner&&e.role==='operator'))throw Error('Владелец должен быть существующим оператором');
 const phones=[...new Set(p.clients.flatMap(c=>[c.phone,...c.linkedPhones||[]]).map(normalizePhone).filter(Boolean))];
 const phone=normalizePhone(input.phone);if(!phones.includes(phone))throw Error('Выберите телефон из объединяемых карточек');
 const drops=input.ids.filter(id=>id!==source.id),all=json(input.ids),removed=json(drops);
 const history=p.clients.flatMap(c=>c.legacyOrderHistory||[]);
 const combined={...source,biography:[...new Set(p.clients.map(c=>c.biography).filter(Boolean))].join('\n\n'),phone,linkedPhones:phones.filter(v=>v!==phone),legacyOrderHistory:history.filter((h,i)=>history.findIndex(v=>v.externalId===h.externalId)===i),version:source.version+1};
 // Preserve the selected owner's original dates; merging never starts a new retention period.
 if(source.owner&&!['ЧС','ПВ'].includes(source.sheet||''))combined.sheet='К';
 const tables=(await d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results as {name:string}[];
 const refs:{name:string;cols:string[]}[]=[];
 for(const {name} of tables){
  const cols=((await d.prepare('PRAGMA table_info('+quote(name)+')').all()).results as {name:string}[]).map(c=>c.name);
  if(!cols.includes('client_id')||historical.has(name))continue;
  if(!supported.has(name))throw Error('Найдены новые связи клиента. Объединение требует проверки: '+name);
  refs.push({name,cols});
 }
 await d.prepare('CREATE TABLE IF NOT EXISTS client_merge_audit(id TEXT PRIMARY KEY,at TEXT NOT NULL,actor_id TEXT NOT NULL,client_id TEXT NOT NULL,data TEXT NOT NULL)').run();
 await d.prepare('CREATE TABLE IF NOT EXISTS client_merge_guard(valid INTEGER NOT NULL CHECK(valid=1))').run();
 const at=new Date().toISOString(),id='MERGE-'+randomUUID();
 const statements:any[]=[];
 const check=(sql:string,args:unknown[]=[])=>statements.push(d.prepare('INSERT INTO client_merge_guard(valid) SELECT CASE WHEN '+sql+' THEN 1 ELSE 0 END').bind(...args));
 check('NOT EXISTS(SELECT 1 FROM client_phone_index WHERE phone IN (SELECT value FROM json_each(?)) AND client_id NOT IN (SELECT value FROM json_each(?)))',[json(phones.map(v=>v.replace(/\D/g,''))),all]);
 for(const c of p.clients)check('EXISTS(SELECT 1 FROM clients WHERE id=? AND version=?)',[c.id,c.version]);
 check('(SELECT COUNT(*) FROM orders WHERE client_id IN (SELECT value FROM json_each(?)))=?',[all,p.orders.length]);
 for(const o of p.orders)check('EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?)',[o.id,o.version]);
 // Prevent moving a client while an external dialler upload or call is in progress.
 for(const t of refs){
  if(t.name==='phone_calls')check("NOT EXISTS(SELECT 1 FROM phone_calls WHERE client_id IN (SELECT value FROM json_each(?)) AND ended_at IS NULL)",[all]);
  if(t.name==='crmcalls_items')check("NOT EXISTS(SELECT 1 FROM crmcalls_items WHERE client_id IN (SELECT value FROM json_each(?)) AND state IN ('sending','submitted','unknown'))",[all]);
  if(t.name==='base_dispatch_items')check("NOT EXISTS(SELECT 1 FROM base_dispatch_items WHERE client_id IN (SELECT value FROM json_each(?)) AND state IN ('pending','sending','unknown'))",[all]);
 }
 statements.push(d.prepare('INSERT INTO client_merge_audit(id,at,actor_id,client_id,data) VALUES(?,?,?,?,?)').bind(id,at,actorId,source.id,json({clients:p.clients,orders:p.orders,result:combined,references:{}})));
 // Save every affected relation inside the same transaction before changing any links.
 for(const t of refs){
  const object='json_object('+t.cols.map(c=>"'"+c.replaceAll("'","''")+"',"+quote(c)).join(',')+')';
  statements.push(d.prepare(`UPDATE client_merge_audit SET data=json_set(data,?,json((SELECT COALESCE(json_group_array(${object}),'[]') FROM ${quote(t.name)} WHERE client_id IN (SELECT value FROM json_each(?))))) WHERE id=?`).bind('$.references.'+t.name,all,id));
  if(t.name==='client_phone_index')continue;
  const changeData=t.name!=='orders'&&t.cols.includes('data')?",data=CASE WHEN json_extract(data,'$.clientId') IN (SELECT value FROM json_each(?)) THEN json_set(data,'$.clientId',?) ELSE data END":'';
  statements.push(d.prepare(`UPDATE ${quote(t.name)} SET client_id=?${changeData}${t.name==='orders'?",version=version+1,data=json_set(data,'$.clientId',?,'$.version',version+1)":''} WHERE client_id IN (SELECT value FROM json_each(?))`).bind(source.id,...(changeData?[removed,source.id]:[]),...(t.name==='orders'?[source.id]:[]),removed));
 }
 statements.push(d.prepare('DELETE FROM clients WHERE id IN (SELECT value FROM json_each(?))').bind(removed));
 statements.push(d.prepare('UPDATE clients SET phone=?,data=?,version=version+1 WHERE id=?').bind(phone,json(combined),source.id));
 const event={id:'EV-'+randomUUID(),clientId:source.id,orderId:'',at,actor:'Администратор',actorId,text:`Объединены ${input.ids.length} карточки клиента. Владелец: ${p.owners.find(e=>e.id===source.owner)?.login||'не назначен'}. Все телефоны и история сохранены. Авторы заказов и премии не изменены. Срок закрепления не перезапускался. Журнал: ${id}`};
 statements.push(d.prepare('INSERT INTO events(id,client_id,order_id,at,data) VALUES(?,?,?,?,?)').bind(event.id,source.id,'',at,json(event)));
 statements.push(d.prepare('DELETE FROM client_merge_guard'));
 try{await d.batch(statements);}catch{throw Error('Объединение не выполнено: данные изменились, идёт звонок/выгрузка или есть конфликт связанных записей. Обновите сравнение. Все карточки сохранены.');}
 return {client:combined,auditId:id};
}
