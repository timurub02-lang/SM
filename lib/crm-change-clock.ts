import type {ActivityDb} from './activity-store.ts';

// Triggers also observe imports and old runtimes, without publishing record identifiers.
const tables=['clients','orders','employees','events','settings','incoming_calls','reminders','client_reminders','client_work','redemption_entries'];
const initialized=new WeakMap<ActivityDb,{schema:number;pending?:Promise<void>}>();
export async function initCrmChangeClock(d:ActivityDb){
 const schema=Number(await d.prepare('PRAGMA schema_version').first('schema_version'));
 const saved=initialized.get(d);
 if(saved?.pending)return saved.pending;
 if(saved?.schema===schema)return;
 const state:{schema:number;pending?:Promise<void>}={schema:-1};initialized.set(d,state);
 state.pending=install(d).then(async()=>{state.schema=Number(await d.prepare('PRAGMA schema_version').first('schema_version'));}).finally(()=>{state.pending=undefined;});
 return state.pending;
}
async function install(d:ActivityDb){
 await d.prepare("CREATE TABLE IF NOT EXISTS crm_change_clock(id INTEGER PRIMARY KEY CHECK(id=1),epoch TEXT NOT NULL,revision INTEGER NOT NULL)").run();
 await d.prepare('INSERT OR IGNORE INTO crm_change_clock VALUES(1,?,0)').bind(crypto.randomUUID()).run();
 const existing=(await d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((r:{name:string})=>r.name);
 const statements=[];
 for(const table of tables.filter(t=>existing.includes(t))){
  const columns=(await d.prepare(`PRAGMA table_info(${table})`).all()).results.map((r:{name:string})=>r.name);
  const changed=columns.map((name:string)=>`OLD."${name}" IS NOT NEW."${name}"`).join(' OR ');
  for(const operation of ['INSERT','UPDATE','DELETE']){
   const conditions=[...(operation==='UPDATE'?[`(${changed})`]:[]),...(table==='settings'?[`${operation==='DELETE'?'OLD':'NEW'}.id<>'crm-maintenance-health'`]:[])];
   statements.push(d.prepare(`CREATE TRIGGER IF NOT EXISTS crm_clock_${table}_${operation} AFTER ${operation} ON ${table} ${conditions.length?'WHEN '+conditions.join(' AND '):''} BEGIN UPDATE crm_change_clock SET revision=revision+1 WHERE id=1; END`));
  }
 }
 if(statements.length)await d.batch(statements);
}
export async function crmChangeRevision(d:ActivityDb):Promise<string>{
 const row=await d.prepare('SELECT epoch,revision FROM crm_change_clock WHERE id=1').first();
 if(!row)throw Error('CRM change clock is unavailable');
 return `${row.epoch}:${row.revision}`;
}
