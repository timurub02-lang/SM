import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFileSync,unlinkSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const file=resolve('tests/.pickup-draft-'+process.pid+'.mjs'),requests=[];
const originalFetch=globalThis.fetch;
try{
 const result=await build({stdin:{contents:`export {OrderPickupPoint} from './components/order-pickup-point';export {reset} from 'react';`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'component-harness',setup(b){
  b.onResolve({filter:/^(react|react\/jsx-runtime|@\/components\/cdek-point-select|@\/lib\/order-pickup-point)$/},a=>({path:a.path,namespace:'harness'}));
  b.onLoad({filter:/.*/,namespace:'harness'},a=>({loader:'js',contents:a.path==='react'?`let states=[],cursor=0;export const reset=()=>{cursor=0};export const useState=initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}];};`:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props});export const jsxs=jsx;`:a.path.includes('cdek-point-select')?`export const CdekPointSelect='selector';`:`export const canSelectOrderPickupPoint=()=>true;export const orderPickupPoint=o=>o.cdekPickupPoint;`}));
 }}]});
 writeFileSync(file,result.outputFiles[0].text);const {OrderPickupPoint,reset}=await import(pathToFileURL(file).href);
 let draft=null;const props={order:{id:'test',cdekPickupPoint:{code:'OLD',address:'Old address'}},employee:{id:'op'},staff:[],disabled:false,dirty:false,onChange:v=>{draft=v;}};
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({points:[{code:'NEW',address:'New address'}],selectionId:'lookup'})};};
 const render=()=>{reset();return OrderPickupPoint({...props,draft});};
 const find=(tree,type)=>{if(!tree||typeof tree!=='object')return; if(tree.type===type)return tree;for(const child of [tree.props?.children].flat(Infinity)){const found=find(child,type);if(found)return found;}};
 assert.equal(find(render(),'selector').props.value,'OLD');
 await find(render(),'button').props.onClick();
 // The click starts an async read; allow the resolved lookup to settle.
 await Promise.resolve();await Promise.resolve();
 assert.equal(find(render(),'selector').props.value,'');
 find(render(),'selector').props.onChange('NEW');
 assert.deepEqual(draft,{code:'NEW',selectionId:'lookup'});assert.equal(find(render(),'selector').props.value,'NEW');
 assert.equal(requests.length,1);assert.equal(requests[0].options,undefined,'selection must not POST or autosave');
 assert.equal(props.order.cdekPickupPoint.code,'OLD','saved order remains untouched before explicit save');
 find(render(),'button').props.onClick();assert.equal(draft,null);assert.equal(find(render(),'selector').props.value,'');
 console.log('PVZ draft: load clears search, selection stays local, reload clears draft, no autosave');
}finally{globalThis.fetch=originalFetch;try{unlinkSync(file);}catch{}}
