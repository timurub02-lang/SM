import assert from 'node:assert/strict';
import http from 'node:http';
import ExcelJS from 'exceljs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
import {newProjectSettings} from '../lib/oktell-project-settings.ts';
import {controlSocket} from './fixtures/control-socket.mjs';

const dir=mkdtempSync(join(tmpdir(),'oktell-settings-')),file=join(dir,'test.sqlite'),sql=new DatabaseSync(file);
const base='http://127.0.0.1:3438',origin='https://settings.test',password='synthetic-settings-only';
const socket=controlSocket(join(dir,'control.sock'));let server,logs='',bridgeRequests=0;
const bridge=http.createServer((_req,res)=>{bridgeRequests++;res.writeHead(500).end();});
await new Promise(r=>bridge.listen(socket,r));
async function boot(enabled,native=false){
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{PATH:process.env.PATH,CRM_RUNTIME:'miran',CRM_DATABASE_PATH:file,CRM_ORIGIN:origin,OKTELL_PROJECT_SETTINGS:enabled?'1':'0',OKTELL_SETTINGS_NATIVE:native?'lab-vm105':'',OKTELL_SETTINGS_CREDENTIALS:native?join(dir,'unused-private-file.json'):'',OKTELL_CONTROL_SOCKET:socket,HOSTNAME:'127.0.0.1',PORT:'3438'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<200;i++){try{if((await fetch(base+'/login')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}
 throw Error('Server did not start');
}
async function stop(){if(server&&server.exitCode===null){server.kill();await once(server,'exit');}}
async function call(path,cookie,body,requestOrigin=origin){
 const r=await fetch(base+path,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'Content-Type':'application/json',Origin:requestOrigin}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{}return {status:r.status,headers:r.headers,text,data};
}
try{
 sql.exec(readFileSync('drizzle/0000_cynical_monster_badoon.sql','utf8'));for(const q of authSchema)sql.exec(q);
 const hash=await hashPassword(password);
 for(const [id,role] of [['admin','admin'],['head','department_head'],['operator','operator'],['tester','admin']]){
  sql.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:'Синтетический '+id,role,department:'1',salary:0,bonus:0}));
  sql.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 sql.prepare('INSERT INTO auth_test_accounts VALUES(?)').run('tester');
 await boot(false);
 assert.equal((await call('/api/oktell-projects/import')).status,410);
 assert.equal((await call('/api/oktell-projects/import',null,{})).status,410);
 assert.equal((await call('/api/oktell-projects')).status,410);
 assert.equal((await call('/api/oktell-projects/native')).status,410);
 assert.equal((await call('/api/oktell-projects/native',null,{})).status,410);
 assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='oktell_project_drafts'").get().n,0);
 await stop();await boot(true);
 const cookies={};for(const id of ['admin','head','operator','tester']){const r=await call('/api/auth/login',null,{login:id,password});assert.equal(r.status,200);cookies[id]=r.headers.get('set-cookie').split(';')[0];}
 assert.equal((await call('/oktell-projects')).status,307);
 for(const id of [undefined,'head','operator','tester']){
  assert.equal((await call('/api/oktell-projects/import?projectId='+randomUUID(),cookies[id])).status,403);
  assert.equal((await call('/api/oktell-projects/import',cookies[id],{})).status,403);
  assert.equal((await call('/api/oktell-projects',cookies[id])).status,403);
  assert.equal((await call('/api/oktell-projects',cookies[id],{})).status,403);
 }
 const entry=await call('/oktell-pilot',cookies.admin);assert.equal(entry.status,307);assert.equal(entry.headers.get('location'),'/oktell-projects');
 const page=await call('/oktell-projects',cookies.admin);assert.equal(page.status,200);assert.match(page.text,/Проекты Oktell/);assert.match(page.headers.get('permissions-policy'),/microphone=\(\)/);
 const empty=await call('/api/oktell-projects',cookies.admin);assert.equal(empty.status,200);assert.equal(empty.data.native.canApply,false);assert.equal(empty.data.projects.length,0);assert.equal(empty.data.operators.length,1);
 const cmd={action:'create',id:randomUUID(),settings:newProjectSettings('t1')};
 assert.equal((await call('/api/oktell-projects',cookies.admin,cmd,'https://evil.test')).status,403);
 assert.equal((await call('/api/oktell-projects',cookies.admin,{...cmd,actor:'another-user'})).status,400);
 assert.equal((await call('/api/oktell-projects',cookies.admin,{...cmd,settings:{...cmd.settings,name:'x'.repeat(70000)}})).status,413);
 const created=await call('/api/oktell-projects',cookies.admin,cmd);assert.equal(created.status,200);assert.equal(created.data.project.updatedBy,'admin');assert.equal(created.data.project.revision,1);
 assert.equal((await call('/api/oktell-projects',cookies.admin,cmd)).data.project.revision,1);
 const workbook=new ExcelJS.Workbook();workbook.addWorksheet('Контакты').addRows([['Телефон','Имя','Город'],['79990000001','Синтетический контакт','Москва'],['8 (999) 000-00-01','Дубль',''],['не номер','Ошибка','']]);
 const bytes=Buffer.from(await workbook.xlsx.writeBuffer());
 async function upload(extra={},cookie=cookies.admin,requestOrigin=origin,body=bytes){
  const q=new URLSearchParams({projectId:cmd.id,filename:'контакты.xlsx',action:'preview',...extra});
  const r=await fetch(base+'/api/oktell-projects/import?'+q,{method:'POST',headers:{cookie,Origin:requestOrigin,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body});return {status:r.status,data:await r.json()};
 }
 const template=await fetch(base+'/api/oktell-projects/import?template=1',{headers:{cookie:cookies.admin}});assert.equal(template.status,200);
 const templateBook=new ExcelJS.Workbook();await templateBook.xlsx.load(Buffer.from(await template.arrayBuffer()));assert.equal(templateBook.worksheets[0].getCell('A1').text,'Телефон');
 assert.equal((await upload({},cookies.operator)).status,403);assert.equal((await upload({},cookies.admin,'https://evil.test')).status,403);
 assert.equal((await upload({filename:'старый.xls'})).status,400);
 assert.equal((await upload({},cookies.admin,origin,Buffer.alloc(5*1024*1024+1))).status,413);
 const preview=await upload();assert.equal(preview.status,200);assert.equal(preview.data.preview.added,1);assert.equal(preview.data.preview.duplicates,1);assert.equal(preview.data.preview.invalid,1);
 assert.equal((await call('/api/oktell-projects/import?projectId='+cmd.id,cookies.admin)).data.total,0);
 assert.equal((await upload({action:'confirm',token:'a'.repeat(64)})).status,409);
 const confirm={action:'confirm',token:preview.data.preview.token,phone:'1',name:'2',city:'3',sheet:'1'};
 assert.equal((await upload(confirm)).data.receipt.added,1);assert.equal((await upload(confirm)).data.replayed,true);
 const inventory=(await call('/api/oktell-projects/import?projectId='+cmd.id,cookies.admin)).data;assert.equal(inventory.total,1);assert.equal(inventory.imports.length,1);
 assert.equal((await upload({projectId:randomUUID()})).status,404);
 const changed={...cmd.settings,name:'Сохранённый проект'};
 assert.equal((await call('/api/oktell-projects',cookies.admin,{action:'save',id:cmd.id,revision:1,settings:changed})).status,200);
 assert.equal((await call('/api/oktell-projects',cookies.admin,{action:'save',id:cmd.id,revision:1,settings:{...changed,name:'Устаревший'}})).status,409);
 assert.equal((await call('/api/oktell-projects',cookies.admin,{action:'apply',id:cmd.id})).status,400);
 const history=(await call('/api/oktell-projects?history='+cmd.id,cookies.admin)).data.history;assert.equal(history.length,2);assert.equal(history[1].settings.name,cmd.settings.name);
 await stop();await boot(true);
 assert.equal((await call('/api/oktell-projects',cookies.admin)).data.projects[0].settings.name,'Сохранённый проект');
 assert.equal((await call('/api/oktell-projects/import?projectId='+cmd.id,cookies.admin)).data.total,1);
 const token=cookies.admin.split('=')[1];const {tokenHash}=await import('../lib/auth-crypto.ts');
 sql.prepare('INSERT INTO auth_impersonations(id,session_hash,target_id,started_at,expires_at) VALUES(?,?,?,?,?)').run(randomUUID(),tokenHash(token),'operator',Date.now(),Date.now()+60000);
 assert.equal((await call('/api/oktell-projects',cookies.admin)).status,403);
 assert.equal((await call('/api/oktell-projects/import?projectId='+cmd.id,cookies.admin)).status,403);
 assert.equal((await upload()).status,403);
 assert.equal((await call('/api/oktell-projects',cookies.admin,cmd)).status,403);
 await stop();await boot(true,true);
 for(const id of [undefined,'head','operator','tester','admin']){
  // The admin cookie is still impersonating an operator.
  assert.equal((await call('/api/oktell-projects/native?id='+cmd.id,cookies[id])).status,403);
  assert.equal((await call('/api/oktell-projects/native',cookies[id],{})).status,403);
 }
 sql.prepare('DELETE FROM auth_impersonations WHERE session_hash=?').run(tokenHash(token));
 assert.equal((await call('/api/oktell-projects',cookies.admin)).data.native.canApply,true);
 assert.equal((await call('/api/oktell-projects/native?id='+cmd.id,cookies.admin)).data.state,null);
 assert.equal((await call('/api/oktell-projects/native',cookies.admin,{},'https://evil.test')).status,403);
 assert.equal((await call('/api/oktell-projects/native',cookies.admin,{action:'start',id:cmd.id})).status,400);
 assert.equal((await call('/api/oktell-projects/native',cookies.admin,{data:'x'.repeat(5000)})).status,413);
 assert.equal((await call('/api/oktell-projects/native',cookies.admin,{action:'apply',id:randomUUID(),revision:1,expected:null})).status,404);
 assert.equal(bridgeRequests,0);assert.equal(sql.prepare('SELECT count(*) n FROM clients').get().n,0);assert.equal(sql.prepare('SELECT count(*) n FROM orders').get().n,0);
 console.log('PASS: flag-off isolation, admin/test/role/impersonation boundaries, Origin, body limit, CAS, history, restart persistence, no bridge calls or customer writes');
}catch(e){console.error(logs);throw e;}finally{await stop();await new Promise(r=>bridge.close(r));sql.close();rmSync(dir,{recursive:true,force:true});}
