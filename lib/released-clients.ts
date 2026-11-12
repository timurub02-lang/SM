import type {ActivityDb as Db} from './activity-store.ts';
import {clientAssignment,clientSheet,type Client,type Employee} from './crm.ts';
import {distributionEligible,moscowDate,workDate} from './base-distribution.ts';
export const releasedSheet='Открепились';
export function waitingRelease(c:Client,now=new Date()){
 return !c.owner&&!!c.releasedAt&&Number.isFinite(Date.parse(c.releasedAt))&&Date.parse(c.releasedAt)<=now.getTime()&&!['К','ЧС','ПВ'].includes(clientSheet(c))&&!distributionEligible(c,moscowDate(now));
}
export async function releasedClients(d:Db,now=new Date()){
 const rows:{data:string;version:number}[]=(await d.prepare("SELECT data,version FROM clients WHERE COALESCE(json_extract(data,'$.owner'),'')='' AND COALESCE(json_extract(data,'$.baseType'),'M') IN ('M','J') AND json_extract(data,'$.releasedAt')>=? ORDER BY json_extract(data,'$.releasedAt') DESC,id").bind(new Date(now.getTime()-7*86400000).toISOString()).all()).results;
 return rows.map(r=>({...JSON.parse(r.data),version:r.version} as Client)).filter(c=>waitingRelease(c,now));
}
export const releaseReadyDate=(c:Client)=>workDate(moscowDate(new Date(c.releasedAt!)),2);
export async function assignReleased(d:Db,base:'M'|'J',operatorId:string,selected:{id:string;version:number}[],actorId:string,now=new Date()){
 const row=await d.prepare('SELECT data FROM employees WHERE id=?').bind(operatorId).first();
 const operator:Employee|undefined=row?JSON.parse(row.data):undefined;
 if(!operator||operator.role!=='operator'||operator.baseAccess&&operator.baseAccess!=='both'&&operator.baseAccess!==base)throw Error('Оператор не обрабатывает выбранную базу');
 const at=now.toISOString(),marker=crypto.randomUUID(),statements=[];
 for(const item of selected){
  const row=await d.prepare('SELECT data,version FROM clients WHERE id=?').bind(item.id).first();
  if(!row||row.version!==item.version)continue;
  const c:Client={...JSON.parse(row.data),version:row.version};
  if((c.baseType||'M')!==base||!waitingRelease(c,now))continue;
  const next={...c,...clientAssignment(c,operator.id,at,clientSheet(c)),_baseAssign:marker};
  const event={id:'EV-'+crypto.randomUUID(),clientId:c.id,orderId:'',actorId,actor:'Администратор',at,text:`Передан с листа «Открепились» · ${base} / ${clientSheet(c)} → ${operator.login}`};
  statements.push(d.prepare("UPDATE clients SET data=?,version=version+1 WHERE id=? AND version=? AND COALESCE(json_extract(data,'$.owner'),'')='' AND NOT EXISTS(SELECT 1 FROM base_dispatch_items WHERE client_id=clients.id AND state IN ('pending','sending','unknown')) AND NOT EXISTS(SELECT 1 FROM orders WHERE client_id=clients.id AND json_extract(data,'$.status') NOT IN ('redeemed','returned','refused'))").bind(JSON.stringify(next),c.id,item.version),d.prepare("INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,'',?,? WHERE EXISTS(SELECT 1 FROM clients WHERE id=? AND json_extract(data,'$._baseAssign')=?)").bind(event.id,c.id,at,JSON.stringify(event),c.id,marker));
 }
 const results:{meta:{changes?:number}}[]=statements.length?await d.batch(statements):[];
 const assigned=results.filter((_,i)=>i%2===0).reduce((n,r)=>n+(r.meta.changes||0),0);
 return {assigned,skipped:selected.length-assigned};
}
