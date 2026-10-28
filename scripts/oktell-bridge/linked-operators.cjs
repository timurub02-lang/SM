'use strict';
const fs=require('node:fs');
const make=require('./operator-control.cjs');
const fail=(message,status=403)=>Object.assign(Error(message),{status});
module.exports=function({request,connected,load=()=>{
 try{return JSON.parse(fs.readFileSync(process.env.BRIDGE_OPERATORS||'/etc/sm-oktell-bridge/operators.json','utf8'));}
 catch(e){if(e.code==='ENOENT')return {};throw e;}
}}){
 const controls=new Map();
 function identityFor(actor){
  const links=load(),identity=Object.hasOwn(links,actor)?links[actor]:null;
  if(!identity||!/^E-[a-zA-Z0-9-]+$/.test(actor)||!/^[-0-9a-f]{36}$/i.test(identity.userid)||!/^[-A-Za-z0-9_.@]{1,50}$/.test(identity.userlogin))throw fail('Учётная запись Oktell ещё не подключена для этого сотрудника');
  if(Object.entries(links).some(([id,x])=>id!==actor&&(x.userid===identity.userid||x.userlogin.toLowerCase()===identity.userlogin.toLowerCase())))throw fail('Учётная запись Oktell назначена нескольким сотрудникам');
  return {userid:identity.userid,userlogin:identity.userlogin};
 }
 function get(actor){
  const identity=identityFor(actor),key=JSON.stringify(identity),old=controls.get(actor);
  if(old&&old.key!==key&&old.control.isActive())throw fail('Привязка Oktell изменилась. Сначала завершите прежний сеанс',409);
  if(!old||old.key!==key)controls.set(actor,{key,control:make({request,connected,identity,actor})});
  return controls.get(actor).control;
 }
 return {
  validate:actor=>{get(actor);},
  prepare:(actor,owner)=>get(actor).prepare(actor,owner),
  // A removed or changed mapping must still allow its existing session to log out.
  release:(actor,owner)=>(controls.get(actor)?.control||get(actor)).release(actor,owner),
  read:actor=>get(actor).read(actor),command:body=>get(body?.actor).command(body),
  activeUsers:()=>[...controls.values()].flatMap(c=>c.control.activeUsers()),
  disconnected:()=>{for(const c of controls.values())c.control.disconnected();controls.clear();}
 };
};
