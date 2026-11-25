import assert from 'node:assert/strict';
import {build} from 'esbuild';
// Render the real inbox JSX with an empty client cache; child widgets are irrelevant to navigation.
globalThis.__incomingTab='free';
const built=await build({entryPoints:['components/incoming-inbox.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',logLevel:'silent',plugins:[{name:'inbox-view',setup(api){
 api.onResolve({filter:/^(react(?:\/jsx-runtime)?|lucide-react|\.\/browser-phone|\.\/ui\/dialog|\.\/incoming-client-link|\.\/incoming-order-actions|\.\/operator-select)$/},args=>({path:args.path,namespace:'view'}));
 api.onLoad({filter:/.*/,namespace:'view'},({path})=>({contents:path==='react'?'export const useRef=v=>({current:v});export const useState=v=>[v===\"known\"?globalThis.__incomingTab:v,()=>{}];':path==='react/jsx-runtime'?'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment=\"fragment\";':'export const PhoneIncoming=()=>null,ChevronRight=()=>null,CallButton=()=>null,Dialog=()=>null,DialogContent=()=>null,DialogHeader=()=>null,DialogTitle=()=>null,DialogDescription=()=>null,IncomingClientLink=()=>null,IncomingOrderActions=()=>null,OperatorSelect=()=>null;'}));
}}]});
const {IncomingInbox}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const item={id:'incoming-test',clientId:'client-test',clientName:'Synthetic client',at:'2026-11-14T12:00:00Z',clientOwnerId:'',hasActiveOrder:false,sharedQueue:true};
function render(role,itemPatch={},clients=[],tab='free'){
 globalThis.__incomingTab=tab;const opened=[];
 const tree=IncomingInbox({items:[{...item,...itemPatch}],clients,employees:[],employee:{id:'actor',role},busy:false,onOpenClient:(...args)=>opened.push(args)});
 const cards=[],buttons=[],ndTabs=[],ndActions=[],callTargets=[];function walk(node){if(Array.isArray(node)){node.forEach(walk);return;}if(!node||typeof node!=='object')return;if(node.props?.target?.mode)callTargets.push(node.props.target);if(node.type==='details'&&node.props.className?.includes('incoming-card'))cards.push(node);if(node.type==='button'&&node.props.children==='Карточка клиента')buttons.push(node);if(node.type==='button'&&node.props['aria-label']?.startsWith('НД:'))ndTabs.push(node);if(node.type==='button'&&node.props.children==='Недозвон')ndActions.push(node);walk(node.props?.children);}
 walk(tree);return {buttons,opened,cards,ndTabs,ndActions,callTargets};
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
const assignedFree={assigneeId:'team-operator',sharedQueue:false};
for(const clients of [[],[{id:item.clientId,owner:''}]]) {
 const view=render('department_head',assignedFree,clients);
 assert.deepEqual(view.callTargets,[{mode:'incoming',incomingId:item.id}],'Head calls back on the assigned free-client inquiry');
}
console.log('Inbox navigation: admin missing-cache/free/owned/closed, callback IDs and unchanged operator/head guards passed');

for(const patch of [{clientOwnerId:'owner'},{clientOwnerId:'owner',assigneeId:'actor'}])assert.ok(render('admin',patch,[],'known').cards[0].props.className.includes('incoming-card-owned-no-order'),'Owned clients without active orders are blue regardless of the assigned handler');
for(const [patch,tab] of [[{},'free'],[{assigneeId:'actor'},'free'],[{hasActiveOrder:true,clientOwnerId:'owner'},'known'],[{clientId:undefined},'unknown']])assert.ok(!render('admin',patch,[],tab).cards[0].props.className.includes('incoming-card-owned-no-order'),'Free, active-order and unknown cards are not blue');

const nd=render('admin',{missedUntil:new Date(Date.now()+3600000).toISOString()},[],'free');
assert.equal(nd.cards.length,0,'Deferred card is hidden from its ordinary category');
assert.equal(nd.ndTabs.length,3,'Each active admin category has a paired ND tab');
for(const role of ['admin','operator','department_head','logistic','chief_logistic','redemption'])assert.equal(render(role,{clientOwnerId:'actor'},[],'known').ndActions.length,1,'ND action for '+role);
assert.equal(render('admin',{closedAt:'closed'},[],'closed').ndActions.length,0,'Closed incoming cannot be marked ND');
