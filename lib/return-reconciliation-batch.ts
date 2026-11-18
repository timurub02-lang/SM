import type {ActivityDb as Db} from './activity-store.ts';
import {z} from 'zod';
export const returnReconciliationBatchKey='warehouse-return-reconciliation-20261118';
export type ReturnReconciliationRow={id:string;number:string;deliveredAt:string;stockHandled:boolean;check?:{state:'confirmed'|'discrepancy';at:string;by:string;name:string;note:string}};
export type ReturnReconciliationBatch={revision:string;rows:ReturnReconciliationRow[]};
export async function readReturnReconciliationBatch(d:Db){const r=await d.prepare('SELECT data FROM settings WHERE id=?').bind(returnReconciliationBatchKey).first();return r?JSON.parse(r.data) as ReturnReconciliationBatch:{revision:'',rows:[]} as ReturnReconciliationBatch;}
export async function reconcileReturnBatch(d:Db,p:any,employee:{id:string;name:string;role:string}){
 if(!['admin','logistic','chief_logistic'].includes(employee.role))throw Error('Сверка доступна логистам');
 const input=z.object({revision:z.string().uuid(),ids:z.array(z.string().min(1).max(100)).min(1).max(200),state:z.enum(['confirmed','discrepancy']),note:z.string().trim().max(3000)}).parse(p);
 if(input.state==='discrepancy'&&!input.note)throw Error('Опишите расхождение');
 const batch=await readReturnReconciliationBatch(d);if(batch.revision!==input.revision)throw Error('Список уже изменился. Обновите сверку');
 const selected=new Set(input.ids);if(selected.size!==input.ids.length||input.ids.some(id=>!batch.rows.some(r=>r.id===id&&r.check?.state!=='confirmed')))throw Error('Позиция уже сверена или отсутствует');
 const at=new Date().toISOString(),next={revision:crypto.randomUUID(),rows:batch.rows.map(r=>selected.has(r.id)?{...r,check:{state:input.state,at,by:employee.id,name:employee.name,note:input.note}}:r)};
 const result=await d.prepare("UPDATE settings SET data=? WHERE id=? AND json_extract(data,'$.revision')=?").bind(JSON.stringify(next),returnReconciliationBatchKey,batch.revision).run();if(!result.meta.changes)throw Error('Список уже изменился. Обновите сверку');return next;
}
