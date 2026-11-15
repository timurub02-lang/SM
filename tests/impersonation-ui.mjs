import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFileSync,unlinkSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const file=resolve('tests/.impersonation-ui-'+process.pid+'.mjs');
try{
 const built=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {ImpersonationSession,EnterEmployeeButton} from './components/impersonation-session';export const render=(mode,disabled=false)=>renderToStaticMarkup(<ImpersonationSession mode={mode}><EnterEmployeeButton employeeId="one" disabled={disabled}/><main>Workspace</main></ImpersonationSession>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',packages:'external',jsx:'automatic',logLevel:'silent'});
 writeFileSync(file,built.outputFiles[0].text);const {render}=await import(pathToFileURL(file).href);
 const normal=render(null);assert.ok(normal.includes('Войти как сотрудник'));assert.ok(!normal.includes('Вернуться в администратора'));
 const mode=render({id:'mode',name:'Synthetic operator',adminName:'Synthetic admin'});assert.ok(mode.includes('Вы работаете как Synthetic operator'));assert.ok(mode.includes('Звонки отключены'));assert.ok(mode.includes('Вернуться в администратора'));assert.ok(mode.includes('Workspace'));assert.ok(!mode.includes('Войти как сотрудник'));
 assert.match(render(null,true),/disabled=""/);
 const head=render({id:'head-mode',name:'Synthetic operator',adminName:'Synthetic head',ownerRole:'department_head'});assert.ok(head.includes('Вернуться в кабинет руководителя'));assert.ok(head.includes('Руководитель'));assert.ok(!head.includes('Вернуться в администратора'));

 const revoked=render({id:'revoked',name:'Synthetic operator',adminName:'Former head',ownerRole:'operator'});assert.ok(revoked.includes('Вернуться в свой кабинет'));assert.ok(!revoked.includes('Вернуться в администратора'));
 console.log('Impersonation UI: entry, disabled access, persistent role banner/return and no nested entry passed');
}finally{try{unlinkSync(file);}catch{}}
