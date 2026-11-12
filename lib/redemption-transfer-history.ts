const formatter=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const stamp=(s:string)=>Number.isFinite(Date.parse(s))?formatter.format(new Date(s))+' МСК':'не указан';
export function redemptionTransferText(v:any):string{
 const r=v.operatorReturn;if(!r)return '';
 const deadline='Срок обработки до '+stamp(r.deadline)+'.';
 if(v.changeKind==='return_operator'||v.changeKind==='action'&&r.at===v.updatedAt&&!r.resolvedAt)
  return ['Передан оператору в работу из отдела выкупа.',r.reason&&'Причина: '+r.reason+'.',r.comment&&'Комментарий: '+r.comment+'.',deadline].filter(Boolean).join(' ');
 if(v.changeKind==='operator_return_timeout')return 'Срок обработки истёк — заказ автоматически возвращён в отдел выкупа. Итог обработки не сохранён. '+deadline;
 if(v.changeKind==='operator_nd')return 'Отмечен недозвон по возвращённому оператору заказу. Таймер продолжает идти. '+deadline;
 if(['operator_return_start_now','operator_return_48_hours','operator_return_storage_limit'].includes(v.changeKind))return 'Изменён срок обработки заказа у оператора. '+deadline;
 if(r.resolvedAt===v.updatedAt){
  if(v.changeKind==='delivery')return 'Передача оператору завершена: СДЭК сообщил о вручении заказа.';
  const result=v.result==='date'?'дата '+(v.resultDate||'').split('-').reverse().join('.'):v.result==='to_return'?'на возврат':v.result;
  return 'Обработка возвращённого заказа завершена. Сохранён итог: '+result+'.';
 }
 return '';
}
