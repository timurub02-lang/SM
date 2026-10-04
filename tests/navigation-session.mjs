import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {readSessionTab,writeSessionTab,useSessionTab} from '../hooks/use-session-tab.ts';

assert.equal(readSessionTab('crm-navigation:admin'),null,'Server rendering needs no browser storage');
function Page(){const [view]=useSessionTab('crm-navigation:admin','mine',['mine','team']);return createElement('span',null,view);}
assert.equal(renderToString(createElement(Page)),'<span>mine</span>');
const saved=new Map([
 ['crm-navigation:admin','team'],
 ['crm-navigation:admin:team:role','courier'],
 ['crm-navigation:operator','orders'],
 ['crm-navigation:operator:orders:filter','paid'],
]);
globalThis.window={sessionStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)}};
assert.equal(readSessionTab(null),null,'No restoration before the employee is known');
for(const [key,value] of saved)assert.equal(readSessionTab(key),value);
assert.equal(readSessionTab('crm-navigation:another-employee'),null,'Accounts do not share navigation');
assert.equal(readSessionTab('crm-navigation:operator:moscow:filter'),null,'Sections have separate filters');
writeSessionTab('crm-navigation:operator:orders:filter','new');
assert.equal(readSessionTab('crm-navigation:operator:orders:filter'),'new','Creating an order can open the New tab');
writeSessionTab(null,'team');
assert.equal(saved.has(null),false);
Object.defineProperty(window,'sessionStorage',{get(){throw new Error('Storage blocked');}});
assert.equal(readSessionTab('crm-navigation:admin'),null,'Unavailable storage must not break the CRM');
assert.doesNotThrow(()=>writeSessionTab('crm-navigation:admin','orders'));
delete globalThis.window;
console.log('Navigation storage: SSR, employee/section isolation and blocked storage passed');
