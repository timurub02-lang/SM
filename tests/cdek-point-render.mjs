import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFileSync,unlinkSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const file=resolve('tests/.cdek-point-render-'+process.pid+'.mjs');
try{
 const built=await build({stdin:{contents:`import React from 'react';import {renderToString} from 'react-dom/server';import {CdekPointSelect} from './components/cdek-point-select';export const render=(points,value='',disabled=false)=>renderToString(<CdekPointSelect points={points} value={value} disabled={disabled} onChange={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',packages:'external',jsx:'automatic',logLevel:'silent'});
 writeFileSync(file,built.outputFiles[0].text);const {render}=await import(pathToFileURL(file).href);
 for(const points of [[],[{code:'TEST',address:'Тестовая улица, 1',workTime:'09–18'}]])for(const disabled of [false,true]){
  const html=render(points,'',disabled);assert.ok(html.includes('ПВЗ получателя'));assert.ok(html.includes('combobox'));
 }
 assert.ok(render([{code:'TEST',address:'Тестовая улица, 1',workTime:'09–18'}],'TEST').includes('TEST'));
 console.log('PVZ selector renders empty/loaded/disabled/saved states without missing portal context');
}finally{try{unlinkSync(file);}catch{}}
