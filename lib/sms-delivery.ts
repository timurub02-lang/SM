export const deliveryLabels:Record<string,string>={enqueued:'В очереди',accepted:'Принято к отправке · доставка пока не подтверждена',delivered:'Доставлено','non-delivered':'Не доставлено',scheduled:'Запланировано',canceled:'Отменено',wait:'Ожидает отправки',overdue:'Не доставлено · истёк срок ожидания'};
export function smsDelivery(ids:number[],statuses:Record<string,string>={}){
 const values=ids.map(id=>statuses[String(id)]||'unknown');
 const failed=values.some(s=>['non-delivered','overdue','canceled'].includes(s));
 const delivered=values.length>0&&values.every(s=>s==='delivered');
 const status=delivered?'delivered':failed?'non-delivered':values.length&&values.every(s=>s===values[0])?values[0]:'pending';
 const reason=values.includes('overdue')?'Истёк срок ожидания доставки':values.includes('canceled')?'Отправка отменена':null;
 return {status,label:deliveryLabels[status]||'Доставка пока не подтверждена',failed,reason};
}
