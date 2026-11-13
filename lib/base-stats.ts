import type {Employee} from './crm.ts';

export function baseStats(employees:Employee[],counts:{owner:string;total:number}[]){
 const byOwner=new Map(counts.map(row=>[row.owner,row.total]));
 return employees.filter(e=>e.role==='operator'||e.role==='department_head').map(e=>({
  id:e.id,name:e.name,login:e.login,department:e.department,role:e.role,
  clients:e.role==='department_head'?employees.filter(o=>!!e.department&&o.role==='operator'&&o.department===e.department).reduce((n,o)=>n+(byOwner.get(o.id)||0),0):byOwner.get(e.id)||0
 })).sort((a,b)=>b.clients-a.clients||a.login.localeCompare(b.login,'ru'));
}

export function filterBaseStats(rows:ReturnType<typeof baseStats>,department:string){
 const selected=rows.filter(r=>!department||r.department===department&&r.role==='operator');
 return {rows:selected,total:selected.filter(r=>r.role==='operator').reduce((sum,r)=>sum+r.clients,0)};
}
