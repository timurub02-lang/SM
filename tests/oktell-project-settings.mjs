import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {newProjectSettings,projectSettingsSchema,settingsChecklist} from '../lib/oktell-project-settings.ts';
import {readProjectDrafts,readProjectHistory,saveProjectDraft} from '../lib/oktell-project-store.ts';

const sql=new DatabaseSync(':memory:');
const wrap=(query,args=[])=>({bind:(...values)=>wrap(query,values),first:async()=>sql.prepare(query).get(...args),all:async()=>({results:sql.prepare(query).all(...args)}),run:()=>({meta:sql.prepare(query).run(...args)})});
const db={prepare:query=>wrap(query),batch:async statements=>{sql.exec('BEGIN');try{const result=statements.map(s=>s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
try{
 const blank=newProjectSettings(),t1=newProjectSettings('t1');
 for(const settings of [blank,t1])assert.ok(projectSettingsSchema.safeParse(settings).success);
 assert.equal(t1.maxAttempts,3);assert.equal(t1.ringSeconds,50);assert.equal(t1.maxLines,6);assert.equal(t1.schedule.length,8);
 assert.deepEqual(t1.operatorIds,[]);assert.equal(t1.source.kind,'none');assert.equal(t1.callerId,'');
 assert.equal(t1.retries.find(r=>r.outcome==='lost').minutes,5);
 assert.equal(t1.retries.find(r=>r.outcome==='declined').minutes,60);
 for(const change of [
  {name:' '},{maxAttempts:0},{ringSeconds:NaN},{maxLines:1.2},{active:true},{timezone:'not-a-timezone'},
  {schedule:[{day:1,from:'23:00',to:'02:00'}]},
  {schedule:[{day:1,from:'09:00',to:'11:00'},{day:1,from:'10:00',to:'12:00'}]},
  {schedule:[{day:1,from:'25:00',to:'26:00'}]},
  {clientWindow:{from:'20:00',to:'09:00',unknownTimezone:'exclude'}},
  {retries:Array(6).fill(t1.retries[0])},{operatorIds:['one','one']},
  {source:{kind:'existing_native',listId:'',label:'invalid'}},
  {source:{kind:'none',listId:randomUUID(),label:'invalid'}},
  {callerId:'<script>'},
  {results:[{id:randomUUID(),name:'Перезвон',action:'callback',success:true}]},
 ])assert.equal(projectSettingsSchema.safeParse({...t1,...change}).success,false,JSON.stringify(change));
 assert.ok(projectSettingsSchema.safeParse({...blank,schedule:[{day:1,from:'09:00',to:'10:00'},{day:1,from:'10:00',to:'11:00'}]}).success);
 assert.equal(settingsChecklist(t1).find(c=>c.key==='native').complete,false);
 const id=randomUUID(),command={action:'create',id,settings:t1};
 const created=await saveProjectDraft(db,'admin-a',command);assert.equal(created.revision,1);assert.equal(created.status,'draft');
 assert.equal((await saveProjectDraft(db,'admin-a',command)).revision,1);
 assert.equal((await readProjectHistory(db,id)).length,1);
 await assert.rejects(saveProjectDraft(db,'admin-b',command),e=>e.status===409);
 const changed={...t1,name:'Новое имя',description:'Сохранённая настройка'};
 const saved=await saveProjectDraft(db,'admin-a',{action:'save',id,revision:1,settings:changed});assert.equal(saved.revision,2);
 assert.equal((await saveProjectDraft(db,'admin-a',{action:'save',id,revision:1,settings:changed})).revision,2);
 await assert.rejects(saveProjectDraft(db,'admin-a',{action:'save',id,revision:1,settings:{...changed,name:'Устаревшая вкладка'}}),e=>e.status===409);
 assert.equal((await readProjectDrafts(db))[0].settings.name,'Новое имя');
 const history=await readProjectHistory(db,id);assert.deepEqual(history.map(h=>h.revision),[2,1]);assert.equal(history[1].settings.name,t1.name);
 const restored=await saveProjectDraft(db,'admin-a',{action:'save',id,revision:2,settings:history[1].settings});assert.equal(restored.revision,3);
 assert.equal((await readProjectHistory(db,id)).length,3);
 await assert.rejects(saveProjectDraft(db,'admin-a',{action:'save',id,revision:3,settings:{...t1,active:true}}));
 // A failed audit write must roll back the settings too.
 sql.exec("CREATE TRIGGER reject_test_history BEFORE INSERT ON oktell_project_draft_history WHEN NEW.revision=4 BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
 await assert.rejects(saveProjectDraft(db,'admin-a',{action:'save',id,revision:3,settings:changed}));
 assert.equal((await readProjectDrafts(db))[0].revision,3);
 console.log('PASS: T1 preset, validation, unknown-field rejection, CAS, lost-response retry, immutable history and atomic rollback; no native requests');
}finally{sql.close();}
