import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import ExcelJS from 'exceljs';
import {openDatabase} from '../server/sqlite.ts';
import {authSchema} from '../lib/auth-schema.ts';
import {queueExport,authorizedExport} from '../lib/export-jobs.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-export-worker-')),path=join(dir,'db.sqlite'),d=openDatabase(path),require=createRequire(import.meta.url);
const admin={id:'a',role:'admin',login:'admin',name:'Admin'},head={id:'h',role:'department_head',department:'1',login:'head',name:'Head'};
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 for(const sql of authSchema)await d.prepare(sql).run();
 for(const e of [admin,head,{id:'o',role:'operator',department:'1',login:'operator',name:'Operator'}]){await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();await d.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').bind(e.id,'synthetic').run();}
 for(let i=0;i<30;i++){const c={id:'c'+i,phone:'+799900000'+i,name:'Имя '+i,owner:'o',baseType:i%2?'J':'M',sheet:'П',importFields:{'Канал':'Тест','ФИО':'не дублировать'},linkedPhones:i===0?['+79991111111']:[]};await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(c.id,c.phone,JSON.stringify(c)).run();}
 await d.prepare("INSERT INTO settings VALUES('premium-ledger',?)").bind(JSON.stringify({revision:'test',activePeriod:'2026-11-1',initialPeriod:'2026-11-1',periods:{'2026-11-1':{status:'open',signatures:{}}}})).run();
 await build({stdin:{contents:"export {baseWorkbook} from './lib/base-export.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:join(dir,'helpers.cjs'),logLevel:'silent'});
 const {baseWorkbook}=require(join(dir,'helpers.cjs')),legacy=await baseWorkbook(d,'M'),original=new ExcelJS.Workbook();await original.xlsx.load(await legacy.xlsx.writeBuffer());
 await build({entryPoints:['scripts/sync-exports.mjs'],bundle:true,platform:'node',format:'esm',plugins:[{name:'installed-exceljs',setup(build){build.onResolve({filter:/^exceljs$/},()=>({path:pathToFileURL(require.resolve('exceljs')).href,external:true}));}}],outfile:join(dir,'worker.mjs'),logLevel:'silent'});
 // Bundle local dependencies and use the installed ExcelJS module exactly as the release does.
 const run=()=>new Promise((resolve,reject)=>{let logs='';const p=spawn(process.execPath,[join(dir,'worker.mjs')],{env:{...process.env,CRM_DATABASE_PATH:path,CRM_EXPORT_DIRECTORY:join(dir,'files')},stdio:['ignore','pipe','pipe']});p.stdout.on('data',x=>logs+=x);p.stderr.on('data',x=>logs+=x);p.once('error',reject);p.once('exit',code=>resolve({code,logs}));});
 const first=await queueExport(d,admin,'base','M','first'),second=await queueExport(d,admin,'base','M','second');
 const runs=await Promise.all([run(),run()]);assert.ok(runs.every(r=>r.code===0),JSON.stringify(runs));await run();
 for(const job of [first,second]){
  const done=await authorizedExport(d,admin,job.id);assert.equal(done.state,'ready');
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(join(dir,'files',job.id+'.'+done.claim+'.xlsx'));
  assert.deepEqual(book.worksheets.map(s=>s.name),original.worksheets.map(s=>s.name));
  for(const sheet of original.worksheets){const actual=book.getWorksheet(sheet.name);assert.deepEqual(actual.getSheetValues(),sheet.getSheetValues(),'every value survives the streaming export');assert.equal(actual.columns[0]?.width,sheet.columns[0]?.width);}
 }
 const premium=await queueExport(d,head,'premium','2026-11-1','premium');assert.equal((await run()).code,0);assert.equal((await authorizedExport(d,head,premium.id)).state,'ready');
 const revoked=await queueExport(d,admin,'base','J','revoked');await d.prepare('UPDATE auth_accounts SET enabled=0 WHERE employee_id=?').bind(admin.id).run();assert.equal((await run()).code,1);assert.equal((await authorizedExport(d,admin,revoked.id)).state,'failed');
 assert.ok(readdirSync(join(dir,'files')).every(name=>!name.endsWith('.tmp')));
 console.log('Export worker: concurrent processes, XLSX parity, premium rendering, revoked account and temp cleanup passed');
}finally{d.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'crm-export-worker-'));rmSync(dir,{recursive:true,force:true});}
