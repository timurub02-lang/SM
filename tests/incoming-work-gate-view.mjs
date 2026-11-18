import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['components/incoming-work-gate.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',logLevel:'silent',plugins:[{name:'view',setup(api){
 api.onResolve({filter:/^(react\/jsx-runtime|\.\/ui\/dialog)$/},args=>({path:args.path,namespace:'view'}));
 api.onLoad({filter:/.*/,namespace:'view'},({path})=>({contents:path==='react/jsx-runtime'?'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";':'export const Dialog="Dialog",DialogContent="DialogContent",DialogHeader="DialogHeader",DialogTitle="DialogTitle",DialogDescription="DialogDescription";'}));
}}]});
const {IncomingWorkGate}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function render(preserveForm){const actions=[];const tree=IncomingWorkGate({open:true,gate:{incomingIds:['in'],clientIds:[],orderIds:[],skOrders:[{id:'SK-1',clientId:'c'}]},preserveForm,onIncoming:()=>actions.push('incoming'),onOrder:id=>actions.push(id),onRetry:()=>{}}),nodes=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;nodes.push(n);walk(n.props?.children);}walk(tree);return {nodes,actions};}
const normal=render(false);normal.nodes.find(n=>n.type==='button'&&n.props.children==='Открыть входящие').props.onClick();normal.nodes.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.includes('SK-1')).props.onClick();assert.deepEqual(normal.actions,['incoming','SK-1']);
const preserved=render(true);assert.equal(preserved.nodes.filter(n=>n.type==='a'&&n.props.target==='_blank').length,2,'Existing drafts stay mounted; new processing uses separate tabs');assert.ok(preserved.nodes.some(n=>n.type==='DialogContent'&&n.props.showCloseButton===false));let prevented=false;preserved.nodes.find(n=>n.type==='DialogContent').props.onEscapeKeyDown({preventDefault:()=>prevented=true});assert.equal(prevented,true);
console.log('Incoming gate UI: non-dismissible guard, processing navigation, SK-only links and preserved draft tabs passed');
