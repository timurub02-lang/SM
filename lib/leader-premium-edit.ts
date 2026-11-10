import {z} from 'zod';
import type {Employee} from './crm.ts';
import {recalculateRow,type PremiumLedger} from './premium-ledger.ts';
const rates=z.array(z.object({operatorId:z.string().min(1),rate:z.number().finite().min(0).max(100).nullable()})).max(10000);
export function editLeaderRates(actor:Employee|undefined,leader:Employee|undefined,employees:Employee[],value:unknown,ledger:PremiumLedger|null){
 if(actor?.role!=='admin')throw Error('Проценты руководителя изменяет только администратор');
 if(leader?.role!=='department_head'||!leader.leaderPremium)throw Error('Сначала задайте условия премии руководителя');
 const rows=rates.parse(value),ids=new Set<string>();
 for(const r of rows){const op=employees.find(e=>e.id===r.operatorId);if(ids.has(r.operatorId)||!op||op.role!=='operator'||!(op.department===leader.department&&!!leader.department||leader.leaderPremium.links.some(l=>l.operatorId===op.id)))throw Error('Недопустимый или повторный оператор');ids.add(r.operatorId);}
 const links=leader.leaderPremium.links.filter(l=>!l.operatorId||!ids.has(l.operatorId));
 for(const r of rows)if(r.rate!==null)links.push({operatorId:r.operatorId,login:employees.find(e=>e.id===r.operatorId)!.login,rate:r.rate});
 const terms={...leader.leaderPremium,links};
 const canonical=(v:typeof links)=>JSON.stringify([...v].sort((a,b)=>(a.operatorId||a.login).localeCompare(b.operatorId||b.login)));
 const changed=canonical(links)!==canonical(leader.leaderPremium.links);
 if(!changed)return {terms:leader.leaderPremium,ledger,changed};
 const p=ledger?.periods[ledger.activePeriod];
 if(p&&p.status!=='paid'&&(p.status!=='open'||Object.keys(p.signatures).some(id=>employees.some(e=>e.id===id&&e.department===leader.department))))throw Error('Сначала снимите подпись отдела или верните расчёт на исправление');
 if(!ledger)return {terms,ledger,changed};
 const next=structuredClone(ledger);next.revision=crypto.randomUUID();
 const period=next.periods[next.activePeriod];
 if(period?.status==='open'&&period.rows){const volumes=new Map(period.rows.map(r=>[r.employeeId,r.volume]));const commission=links.reduce((s,l)=>s+Math.round(((volumes.get(l.operatorId)||0)*l.rate/100+Number.EPSILON)*100)/100,0);period.rows=period.rows.map(r=>r.employeeId===leader.id?recalculateRow({...r,terms,commission},r.input,r.rate,next.activePeriod):r);}
 return {terms,ledger:next,changed};
}
