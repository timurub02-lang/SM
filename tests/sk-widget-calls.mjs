import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {skWidgetConfig} from '../lib/sk-widget-calls.ts';

const crm='https://crm.smanalytics.ru',origin='https://phone.smcrm.ru';
const operator={id:'operator-10',role:'operator'};
const env={CRM_SK_WIDGET_ORIGIN:origin,CRM_SK_WIDGET_PILOTS:'{"operator-10":"21"}'};
assert.deepEqual(skWidgetConfig(operator,crm,env),{origin,skUserId:'21'});
for(const role of ['courier','purchasing','logistic'])assert.equal(skWidgetConfig({...operator,role},crm,env),null);
assert.equal(skWidgetConfig({...operator,impersonation:{}},crm,env),null);
for(const config of [{}, {...env,CRM_SK_WIDGET_PILOTS:'{}'}, {...env,CRM_SK_WIDGET_PILOTS:'invalid'}, {...env,CRM_SK_WIDGET_ORIGIN:crm},{...env,CRM_SK_WIDGET_ORIGIN:'https://smcrm.ru'},{...env,CRM_SK_WIDGET_ORIGIN:'https://phone.smcrm.ru/path'}])assert.equal(skWidgetConfig(operator,crm,config),null);

const source=readFileSync(new URL('../public/sk-phone/phone.mjs',import.meta.url),'utf8');
function fixture(href=origin+'/sk-phone/index.html'){
  const messages=[],scripts=[],dialed=[];
  const parent={postMessage:(data,target)=>{assert.equal(target,crm);messages.push(data);}};
  const listeners=new Map(),modelEvents=new Map(),ours={isEnded:()=>false};
  let widget,receive;
  class Phone{
    constructor(){widget=this;this.user={id:21};this.settings={hide_phone_numbers:true,status:'ready'};this.phoneModel={get:key=>this.settings[key],on:(key,cb)=>modelEvents.set(key,cb),currentCall:null};}
    on(key,cb){listeners.set(key,cb);}
    getCurrentUser(){return this.user;}
    show(){}
    makeCall(n){dialed.push(n);return {done(cb){cb(ours);return this;},fail(){}};}
  }
  const window={addEventListener:(type,cb)=>{if(type==='message')receive=cb;},Tube:{Widgets:{Phone}}};
  vm.runInNewContext(source,{window,parent,URL,location:new URL(href),document:{createElement:()=>({}),head:{append:s=>scripts.push(s)}}});
  const send=(type,fields={},overrides={})=>receive({source:parent,origin:crm,data:{channel:'sm-sk-phone-v1',type,...fields},...overrides});
  const init=()=>{send('init',{operatorId:'21'});assert.equal(scripts.length,1);window.Tube.ready();listeners.get('ready')();return widget;};
  return {messages,scripts,dialed,send,init,modelEvents,ours};
}
const payload={attempt:'a',number:'+70000000000'};
for(const href of [crm+'/sk-phone/index.html',origin+'/sk-phone/index.html?bad=1']){
  const f=fixture(href);f.send('init',{operatorId:'21'});assert.equal(f.scripts.length,0);
}
const f=fixture();f.send('init',{operatorId:'21'},{source:{}});f.send('init',{operatorId:'21'},{origin:'https://external.example'});assert.equal(f.scripts.length,0);
f.init();assert.equal(f.messages.at(-1).ready,true);assert.equal(f.dialed.length,0);
f.send('dial',payload,{source:{}});assert.equal(f.dialed.length,0);
f.send('dial',payload);f.send('dial',payload);assert.deepEqual(f.dialed,[payload.number]);
f.modelEvents.get('call:connected')({});f.modelEvents.get('call:ended')({});assert.equal(f.messages.filter(m=>m.type==='event').length,0);
f.modelEvents.get('call:connected')(f.ours);f.modelEvents.get('call:ended')(f.ours);
assert.deepEqual(f.messages.filter(m=>m.type==='event').map(m=>m.event),['connected','answered-end']);
for(const alter of [p=>{p.user.id=22;},p=>{p.settings.hide_phone_numbers=false;},p=>{p.settings.status='disconnected';},p=>{p.phoneModel.currentCall={isEnded:()=>false};}]){
  const f=fixture();alter(f.init());f.send('dial',payload);assert.equal(f.dialed.length,0);assert.equal(f.messages.at(-1).event,'failed');
}
console.log('SK pilot configuration, isolated widget and manual dispatch checks passed.');
