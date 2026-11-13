import type {Employee} from './crm.ts';

export function baseStats(employees:Employee[],counts:{owner:string;total:number}[]){
 const byOwner=new Map(counts.map(row=>[row.owner,row.total]));
 return employees.filter(e=>e.role==='operator'||e.role==='department_head').map(e=>({
  id:e.id,name:e.name,login:e.login,department:e.department,role:e.role,
  clients:e.role==='department_head'?employees.filter(o=>!!e.department&&o.role==='operator'&&o.department===e.department).reduce((n,o)=>n+(byOwner.get(o.id)||0),0):byOwner.get(e.id)||0
 })).sort((a,b)=>b.clients-a.clients||a.login.localeCompare(b.login,'ru'));
}

export function filterBaseStats(rows:ReturnType<typeof baseStats>,department:string){
 const selected=rows.filter(r=>!department||r.department===department).sort((a,b)=>Number(!a.department)-Number(!b.department)||(a.department||'').localeCompare(b.department||'','ru',{numeric:true})||Number(a.role==='department_head')-Number(b.role==='department_head')||b.clients-a.clients||a.login.localeCompare(b.login,'ru'));
 const operators=selected.filter(r=>r.role==='operator');
 return {rows:selected,total:operators.reduce((sum,r)=>sum+r.clients,0),leader:operators.reduce<typeof operators[number]|undefined>((best,row)=>!best||row.clients>best.clients?row:best,undefined)};
}

export function averageBaseClients(rows:ReturnType<typeof baseStats>,department:string){
 const operators=rows.filter(r=>r.role==='operator'&&r.department===department&&r.clients>10);
 return operators.length?operators.reduce((sum,r)=>sum+r.clients,0)/operators.length:null;
}
