import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['components/sk-order-transfers.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',logLevel:'silent',plugins:[{name:'view',setup(api){
 api.onResolve({filter:/^(react(?:\/jsx-runtime)?|sonner)$/},args=>({path:args.path,namespace:'view'}));
 api.onLoad({filter:/.*/,namespace:'view'},({path})=>({contents:path==='react'?'export const useState=v=>[v,()=>{}],useEffect=()=>{},useCallback=v=>v;':path==='react/jsx-runtime'?'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;':'export const toast={};'}));
}}]});
const {SkOrderTransfers}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const opened=[];
const row={id:'request',name:'Synthetic client',at:'2026-11-16T06:00:00Z',reason:'',sender:'',canDecide:false};
const tree=SkOrderTransfers({actorId:'admin',active:true,onCount:()=>{},onChanged:()=>{},onOpenClient:id=>opened.push(id),onDecideCrm:async()=>{},crmRequests:[{...row,clientId:'not-in-workspace'},{...row,id:'unmatched'}]});
const links=[];
function walk(node){if(Array.isArray(node)){node.forEach(walk);return;}if(!node||typeof node!=='object')return;if(node.type==='button'&&node.props.className?.includes('sk-request-client-link'))links.push(node);walk(node.props?.children);}
walk(tree);assert.equal(links.length,1,'Existing clients are linked without a workspace cache; unmatched requests do not get a broken link');links[0].props.onClick();assert.deepEqual(opened,['not-in-workspace']);
console.log('SK request navigation without client cache passed');
