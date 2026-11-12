import {createHash} from 'node:crypto';
import type {ActivityDb} from './activity-store.ts';
import type {Employee} from './crm.ts';
import {initCrmChangeClock} from './crm-change-clock.ts';

export type WorkspaceVersions={workspace:string;tasks:string;cards:string};
const areas=['workspace','tasks','cards'] as const;
const initialized=new WeakMap<ActivityDb,{schema:number;pending?:Promise<void>}>();
const hash=(value:string)=>createHash('sha256').update(value).digest('base64url');
const json=(row:string,key:string)=>`json_extract(${row}.data,'$.${key}')`;

export async function initWorkspaceClock(d:ActivityDb){
 await initCrmChangeClock(d);
 const schema=Number(await d.prepare('PRAGMA schema_version').first('schema_version')),saved=initialized.get(d);
 if(saved?.pending)return saved.pending;
 if(saved?.schema===schema)return;
 const state:{schema:number;pending?:Promise<void>}={schema:-1};initialized.set(d,state);
 state.pending=install(d).then(async()=>{state.schema=Number(await d.prepare('PRAGMA schema_version').first('schema_version'));}).finally(()=>{state.pending=undefined;});
 return state.pending;
}
async function install(d:ActivityDb){
 await d.prepare('CREATE TABLE IF NOT EXISTS crm_workspace_clock(scope TEXT NOT NULL,area TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(scope,area))').run();
 const tables=new Set((await d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((r:{name:string})=>r.name));
 const triggers=new Map((await d.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all()).results.map((r:{name:string;sql:string})=>[r.name,r.sql]));
 if(tables.has('incoming_calls'))await d.prepare('CREATE INDEX IF NOT EXISTS incoming_client_scope ON incoming_calls(client_id,closed_at)').run();
 const statements=[];
 const bump=(recipients:string,changed:readonly string[]=areas)=>`INSERT INTO crm_workspace_clock(scope,area,revision) SELECT recipient,area,1 FROM (${recipients}) CROSS JOIN (${changed.map(a=>`SELECT '${a}' AS area`).join(' UNION ALL ')}) WHERE recipient IS NOT NULL AND recipient<>'' ON CONFLICT(scope,area) DO UPDATE SET revision=revision+1;`;
 const global=bump("SELECT '*' AS recipient");
 for(const table of ['clients','orders','events','incoming_calls','reminders','client_reminders','client_work','redemption_entries','phone_calls','employees','auth_accounts','settings'].filter(t=>tables.has(t))){
  const columns=(await d.prepare(`PRAGMA table_info(${table})`).all()).results.map((r:{name:string})=>r.name);
  for(const op of ['INSERT','UPDATE','DELETE']){
   const images=op==='UPDATE'?['OLD','NEW']:[op==='DELETE'?'OLD':'NEW'];
   const clients:string[]=[],people:string[]=[],departments:string[]=[],shared:string[]=[];
   for(const row of images){
    if(table==='clients'){clients.push(`SELECT ${row}.id AS id`);people.push(`SELECT ${json(row,'owner')} AS id`);}
    if(['orders','events','incoming_calls','client_reminders','client_work','phone_calls'].includes(table)&&columns.includes('client_id'))clients.push(`SELECT ${row}.client_id AS id`);
    if(table==='orders')people.push(`SELECT ${json(row,'manager')} AS id`);
    if(table==='redemption_entries')clients.push(`SELECT client_id AS id FROM orders WHERE id=${row}.order_id`);
    if(['reminders','client_reminders','client_work'].includes(table))people.push(`SELECT ${row}.employee_id AS id`);
    if(table==='incoming_calls'){
     people.push(`SELECT ${row}.assignee_id AS id`);departments.push(`SELECT ${row}.department_id AS id`);
     shared.push(`${row}.shared_queue=1 OR ${row}.client_id IS NULL`);
    }
   }
   if(clients.length){
    const ids=clients.join(' UNION ');
    people.push(`SELECT ${json('c','owner')} AS id FROM clients c WHERE c.id IN (${ids})`,`SELECT ${json('o','manager')} AS id FROM orders o WHERE o.client_id IN (${ids})`);
    if(tables.has('incoming_calls')){
     people.push(`SELECT assignee_id AS id FROM incoming_calls WHERE client_id IN (${ids}) AND closed_at IS NULL`);
     departments.push(`SELECT department_id AS id FROM incoming_calls WHERE client_id IN (${ids}) AND closed_at IS NULL`);
     shared.push(`EXISTS(SELECT 1 FROM incoming_calls WHERE client_id IN (${ids}) AND shared_queue=1 AND closed_at IS NULL)`);
    }
   }
   let body=global;
   if(people.length){
    const ids=people.join(' UNION '),dept=departments.length?` OR ${json('e','department')} IN (${departments.join(' UNION ')})`:'';
    // Heads inherit their operators' changes; shared incoming is visible to every head.
    const recipients=`SELECT e.id AS recipient FROM employees e WHERE e.id IN (${ids}) OR (${json('e','role')}='department_head' AND ((${json('e','department')}<>'' AND (${json('e','department')} IN (SELECT ${json('p','department')} FROM employees p WHERE p.id IN (${ids}) AND ${json('p','role')}='operator')${dept}))${shared.length?' OR ('+shared.join(' OR ')+')':''}))`;
    body=bump(recipients,table==='reminders'?['tasks']:table==='events'?['cards']:areas);
   }
   // Premium membership can cross departments through duplicated external order IDs.
   if(table==='orders'){
    // Comments/version bumps on a redeemed order still notify its owners, but cannot change cross-department premium membership.
    const financialChange=op==='UPDATE'?['id','manager','status','testOnly','priorPremiumPaid','legacyLv','importedPayment','delivery','paymentReceivedAt','paymentReceipt','paymentReceivedAmount','cdekRemittances','cdekHistoryRecovery','premiumStage'].map(key=>`${json('OLD',key)} IS NOT ${json('NEW',key)}`).join(' OR '):'1';
    body+=` INSERT INTO crm_workspace_clock(scope,area,revision) SELECT '*',area,1 FROM (SELECT 'workspace' AS area UNION ALL SELECT 'cards') WHERE (${images.map(row=>`${json(row,'status')}='redeemed'`).join(' OR ')}) AND (${financialChange}) ON CONFLICT(scope,area) DO UPDATE SET revision=revision+1;`;
   }
   let when=op==='UPDATE'?columns.map((c:string)=>`OLD."${c}" IS NOT NEW."${c}"`).join(' OR '):'1';
   if(table==='settings'){
    // Reuse the legacy clock's tested classification of health timestamps and unknown settings.
    const legacy=String(triggers.get(`crm_clock_settings_${op}`));
    when=legacy.match(/ WHEN (.*?) BEGIN /)?.[1]||when;
   }
   const name=`crm_workspace_${table}_${op}`,sql=`CREATE TRIGGER ${name} AFTER ${op} ON ${table} WHEN (${when}) BEGIN ${body} END`;
   if(triggers.get(name)!==sql){
    if(triggers.has(name))statements.push(d.prepare(`DROP TRIGGER ${name}`));
    statements.push(d.prepare(sql));
   }
  }
 }
 // Changing coverage invalidates caches even if a newly observed table already contained data.
 if(statements.length)await d.batch([...statements,d.prepare(global)]);
}
export async function workspaceVersions(d:ActivityDb,e:Employee):Promise<WorkspaceVersions>{
 await initWorkspaceClock(d);
 const epoch=await d.prepare('SELECT epoch FROM crm_change_clock WHERE id=1').first('epoch');
 const rows=(await d.prepare("SELECT scope,area,revision FROM crm_workspace_clock WHERE scope IN ('*',?) ORDER BY scope,area").bind(e.id).all()).results;
 // Session decoding adds defaults (for example testOnly:false); workers use stored employees.
 // Hash only canonical permission fields. Employee edits already advance the durable clock.
 const access=JSON.stringify([e.id,e.role,e.department||'',e.baseAccess||'']);
 return Object.fromEntries(areas.map(area=>[area,hash(JSON.stringify([epoch,access,area,rows.filter((r:{area:string})=>r.area===area)]))])) as WorkspaceVersions;
}
