import assert from 'node:assert/strict';
import {build} from 'esbuild';
// Render the real inbox JSX with an empty client cache; child widgets are irrelevant to navigation.
globalThis.__incomingTab='free';
const built=await build({entryPoints:['components/incoming-inbox.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',logLevel:'silent',plugins:[{name:'inbox-view',setup(api){
 api.onResolve({filter:/^(react(?:\/jsx-runtime)?|lucide-react|\.\/browser-phone|\.\/ui\/dialog|\.\/incoming-client-link|\.\/incoming-order-actions|\.\/operator-select)$/},args=>({path:args.path,namespace:'view'}));
 api.onLoad({filter:/.*/,namespace:'view'},({path})=>({contents:path==='react'?'export const useState=v=>[v===\"known\"?globalThis.__incomingTab:v,()=>{}];':path==='react/jsx-runtime'?'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment=\"fragment\";':'export const PhoneIncoming=()=>null,ChevronRight=()=>null,CallButton=()=>null,Dialog=()=>null,DialogContent=()=>null,DialogHeader=()=>null,DialogTitle=()=>null,DialogDescription=()=>null,IncomingClientLink=()=>null,IncomingOrderActions=()=>null,OperatorSelect=()=>null;'}));
}}]});
const {IncomingInbox}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const item={id:'incoming-test',clientId:'client-test',clientName:'Synthetic client',at:'2026-11-14T12:00:00Z',clientOwnerId:'',hasActiveOrder:false,sharedQueue:true};
function render(role,itemPatch={},clients=[],tab='free'){
 globalThis.__incomingTab=tab;const opened=[];
 const tree=IncomingInbox({items:[{...item,...itemPatch}],clients,employees:[],employee:{id:'actor',role},busy:false,onOpenClient:(...args)=>opened.push(args)});
 const cards=[],buttons=[];function walk(node){if(Array.isArray(node)){node.forEach(walk);return;}if(!node||typeof node!=='object')return;if(node.type==='details'&&node.props.className?.includes('incoming-card'))cards.push(node);if(node.type==='button'&&node.props.children==='Карточка клиента')buttons.push(node);walk(node.props?.children);}
 walk(tree);return {buttons,opened,cards};
}
for(const [patch,tab] of [[{},'free'],[{clientOwnerId:'other'},'known'],[{closedAt:'2026-11-14T13:00:00Z'},'closed']]){
 const view=render('admin',patch,[],tab);assert.equal(view.buttons.length,1,'Admin card navigation must not depend on the client cache');
 view.buttons[0].props.onClick();assert.deepEqual(view.opened,[[item.clientId,patch.closedAt?undefined:item.id]]);
}
assert.equal(render('admin',{clientId:undefined},[],'unknown').buttons.length,0);
assert.equal(render('admin',{spam:true},[],'spam').buttons.length,0);
assert.equal(render('operator',{clientOwnerId:'other'},[],'known').buttons.length,0,'Foreign operator card remains hidden');
assert.equal(render('department_head',{},[],'free').buttons.length,1,'Head can inspect an available free client through incoming');
assert.equal(render('operator',{assigneeId:'actor'},[],'known').buttons.length,1,'Assigned free-client history remains available');
assert.equal(render('operator',{clientOwnerId:'actor'},[{id:item.clientId,owner:'actor'}],'known').buttons.length,1);
console.log('Inbox navigation: admin missing-cache/free/owned/closed, callback IDs and unchanged operator/head guards passed');

for(const patch of [{},{assigneeId:'actor'}])assert.ok(render('admin',patch).cards[0].props.className.includes('incoming-card-free'),'Free clients remain blue after handoff');
for(const [patch,tab] of [[{clientOwnerId:'owner'},'known'],[{hasActiveOrder:true},'known'],[{clientId:undefined},'unknown']])assert.ok(!render('admin',patch,[],tab).cards[0].props.className.includes('incoming-card-free'),'Owned, active-order and unknown cards keep their existing colors');
