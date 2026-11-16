import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFileSync,unlinkSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const file=resolve('tests/.personal-reminder-ui-'+process.pid+'.mjs');
try{
 const built=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {PersonalReminderBanner} from './components/personal-reminder-banner';import {OperatorSelect} from './components/operator-select';export const banner=(rows,now)=>renderToStaticMarkup(<PersonalReminderBanner rows={rows} clients={new Map([['client',{name:'Клиент Тест'}]])} now={now} onOpen={()=>{}}/>);export const select=()=>renderToStaticMarkup(<OperatorSelect operators={[{id:'op',name:'Другое имя',login:'POD_Login'}]} value="" onChange={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',packages:'external',jsx:'automatic',logLevel:'silent'});
 writeFileSync(file,built.outputFiles[0].text);const {banner,select}=await import(pathToFileURL(file).href);
 const now=Date.parse('2026-11-16T09:00:00Z'),row={id:'r',clientId:'client',due:'2026-11-16T09:00:00Z',text:'Согласовать повтор',createdAt:'2026-11-15T09:00:00Z'};
 assert.equal(banner([],now),'');assert.equal(banner([row],now-1),'');
 const html=banner([row,{...row,id:'later',due:'2026-11-17T09:00:00Z',text:'Будущее'}],now);
 for(const text of ['Клиент Тест','Согласовать повтор','Открыть напоминание','МСК'])assert.ok(html.includes(text));assert.ok(!html.includes('Будущее'));
 assert.ok(banner([row],now+86400000).includes('Согласовать повтор'),'Overdue reminder remains visible until closed');
 assert.ok(select().includes('<option value="op">POD_Login</option>'));assert.ok(!select().includes('Другое имя'));
 console.log('Personal reminder banner: due boundary, future exclusion, overdue visibility, client/text and CRM login labels passed');
}finally{try{unlinkSync(file);}catch{}}
