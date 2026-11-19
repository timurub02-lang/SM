import assert from 'node:assert/strict';
import {build} from 'esbuild';
globalThis.operatorQuery=null;
const compiled=await build({entryPoints:['components/operator-select.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',logLevel:'silent',plugins:[{name:'view',setup(api){
 api.onResolve({filter:/^(react|react\/jsx-runtime|lucide-react)$/},args=>({path:args.path,namespace:'view'}));
 api.onLoad({filter:/.*/,namespace:'view'},({path})=>({contents:path==='react'?'export const useState=()=>[globalThis.operatorQuery,v=>globalThis.operatorQuery=v];':path==='react/jsx-runtime'?'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;':'export const Search=()=>null;'}));
}}]});
const {OperatorSelect}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const operators=[{id:'1',name:'Ярцева',login:'UDL_Yarceva_04.26',department:'1'},{id:'2',name:'Иванова',login:'M31_Ivanova',department:'2'}];
let value='';function render(extra={}){const tree=OperatorSelect({operators,value,onChange:id=>value=id,...extra});const children=tree.props.children;return {input:children[1].props.children[1].props,select:children[2].props};}
assert.equal(render().select.size,undefined);
render().input.onChange({target:{value:'UDL_'}});
assert.equal(render().select.size,2,'Typing four characters opens results');
assert.equal(render().select.children[1].length,1);
render().select.onChange({target:{value:'1'}});
assert.equal(value,'1');assert.equal(render().select.size,undefined,'Selection collapses results');assert.equal(render().input.value,'UDL_Yarceva_04.26');
render().input.onChange({target:{value:'absent'}});assert.equal(value,'');assert.equal(render().select.children[0].props.children,'Операторы не найдены');
render().input.onChange({target:{value:''}});assert.equal(render().select.size,undefined);
assert.equal(render({disabled:true}).select.disabled,true);
assert.equal(render({required:true}).select.required,true);
assert.equal(render({groupByDepartment:true}).select.children[1][0].type,'optgroup');
console.log('Operator dropdown: typed prefix, selection/collapse, empty result, clear, disabled, required and groups passed');
