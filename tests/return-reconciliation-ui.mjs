import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const built=await build({entryPoints:['components/return-reconciliation.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',logLevel:'silent',plugins:[{name:'return-alert-state',setup(api){api.onResolve({filter:/^react$/},args=>args.importer.endsWith('/components/return-reconciliation.tsx')?{path:'hooks',namespace:'fixture'}:undefined);api.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useState=()=>[globalThis.__returnAlert.values[globalThis.__returnAlert.index++],()=>{}];export const useEffect=()=>{};export const useCallback=f=>f;'}));}}]});
const module={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
function render(rows,error='',role='logistic'){
 globalThis.__returnAlert={index:0,values:[false,[],'',false,error,{revision:'',rows}]};
 return renderToStaticMarkup(createElement(module.exports.ReturnReconciliation,{employee:{id:'viewer',role},busy:false,mutate:async()=>true,openOrder:()=>{}}));
}
try{
 assert.equal(render([]),'');
 const offline=render([],'Не удалось обновить список возвратов');
 assert.match(offline,/notice amber/);assert.match(offline,/Повторить/);
 assert.doesNotMatch(offline,/return-reconciliation-alert|СДЭК отметил вручение|Сверьте возвраты/);
 const pending=[{id:'LV-test',number:'123',deliveredAt:'2026-11-15T15:00:00Z',stockHandled:true}];
 assert.match(render(pending),/return-reconciliation-alert/);assert.match(render(pending),/СДЭК отметил вручение/);
 assert.match(render(pending,'Не удалось обновить список возвратов'),/return-reconciliation-alert/);
 assert.equal(render([{...pending[0],check:{state:'confirmed'}}]),'');
 assert.equal(render(pending,'','operator'),'');
 console.log('Return alert UI: empty list hidden, offline empty list is neutral with retry, known pending returns remain visible, confirmed and unauthorized hidden');
}finally{delete globalThis.__returnAlert;}
