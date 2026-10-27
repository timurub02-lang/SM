import type {ActivityDb} from './activity-store.ts';
import type {Employee} from './crm.ts';
import {initPhone,displayPhoneCall,callResults,type PhoneCall} from './phone-store.ts';
export async function employeeCallJournal(d:ActivityDb,actor:Employee,employeeId:string){
 if(actor.role!=='admin')throw Error('Журнал сотрудников доступен администратору');
 await initPhone(d);
 const rows=(await d.prepare('SELECT * FROM phone_calls WHERE actor_id=? AND (client_id IS NOT NULL OR order_id IS NOT NULL) ORDER BY started_at DESC,seq DESC LIMIT 50').bind(employeeId).all()).results as PhoneCall[];
 return rows.map(c=>({id:'call:'+c.id,at:c.started_at,type:c.order_id?'order' as const:'client' as const,target:c.order_id||c.client_id!,text:'Звонок · '+(callResults[displayPhoneCall(c).status]||'Результат неизвестен')}));
}
