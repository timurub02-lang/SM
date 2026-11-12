import {pendingConfirmationRequest,type Order} from './crm.ts';
import {orderDisplayGroup} from './order-premium-stage.ts';
import {courierLabel} from './courier.ts';
import {cdekStatuses} from './cdek-statuses.ts';
export function orderNextAction(o:Order):string{
 if(orderDisplayGroup(o).id==='sent'&&!['moscow_courier','russian_post'].includes(o.delivery||''))return o.cdekStatus?(cdekStatuses.find(s=>s.code===o.cdekStatus!.code)?.label||o.cdekStatus.code):'Статус СДЭК пока не получен';
 if(pendingConfirmationRequest(o))return 'Подтвердить по просьбе клиента';
 if(o.contact!=='none')return o.contact==='missed'?'Недозвон':'Перезвонить';
 if(['confirm','extra'].includes(o.status))return 'Ожидает подтверждения';
 if(o.status==='check')return 'Ожидает проверки администратора';
 if(o.status==='rework')return 'Ожидает доработки оператором';
 if(o.status==='draft')return 'Ожидает оформления';
 if(o.delivery==='moscow_courier'&&o.courier)return courierLabel(o);
 if(['packing','phone'].includes(o.status))return 'Ожидает подготовки отправления';
 if(o.status==='pickup')return 'Ожидает получения клиентом';
 if(o.status==='shipping')return 'Ожидает доставки';
 return '—';
}
