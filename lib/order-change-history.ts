import {statuses,type Order,type Employee} from './crm.ts';

const labels:Record<string,string>={
 address:'Адрес',addressParts:'Поля адреса',items:'Корзина',delivery:'Способ доставки',status:'Статус',manager:'Оператор',logistic:'Логист',clientId:'Клиент',
 comment:'Комментарий оператора',operatorComments:'Комментарии оператора',logisticComment:'Комментарий логиста',waybillComment:'Комментарий для бланка',reason:'Причина',returnReason:'Причина возврата',returnKind:'Тип возврата',contact:'Результат связи',due:'Время перезвона',round:'Круг обработки',extra:'Дополнительное подтверждение',zvd:'ЗВД',pv:'ПВ',pvMarkedAt:'Дата ПВ',blacklistedAt:'Внесение в ЧС',
 createdAt:'Дата создания',confirmedAt:'Дата подтверждения',shippedAt:'Дата отправки',redeemedAt:'Дата оплаты',returnedAt:'Дата возврата',cancelledAt:'Дата отмены',adminReviewedAt:'Проверка администратором',
 draftHours:'Срок оформления, ч',confirmationStartedAt:'Начало подтверждения',confirmationHours:'Срок подтверждения, ч',extraCallbackAt:'Отложенное подтверждение',noAnswerDeadline:'Срок подтверждения до',reworkHours:'Срок доработки, ч',reworkDeadline:'Срок доработки до',finalConfirmHours:'Срок финального подтверждения, ч',finalHandoffAt:'Передача на финальное подтверждение',refusalHandoffAt:'Передача отказа',
 deliveryPackingAt:'Переход на упаковку',deliveryConfirmationAuthor:'Кто получил согласие клиента',confirmationAuthor:'Кто подтвердил',cancellationAuthor:'Кто отменил',contactAuthor:'Кто связался',confirmationRequest:'Запрос подтверждения',clientWaiting:'Клиент ждёт звонка',deliveryChange:'Смена доставки',deliveryReset:'Сброс расчёта доставки',packingReworkDelivery:'Доставка до возврата',
 manualDeliveryCost:'Стоимость доставки',packingWaybillAt:'Накладная на сборку',warehouseReturnedAt:'Возврат на склад',postalTrackingNumber:'Трек Почты России',postalBuyoutReport:'Отчёт выкупа Почты России',
 cdekPickupPoint:'ПВЗ получателя',selectedAt:'Дата выбора',cdekTariff:'Тариф и ПВЗ СДЭК',cdekStatus:'Статус СДЭК',cdekExported:'Выгружен в СДЭК',cdekDeleting:'Удаление из СДЭК',cdekExportError:'Ошибка выгрузки СДЭК',cdekWaybillReceived:'Накладная СДЭК получена',cdekTrackingNumber:'Трек СДЭК',cdekTransferredAt:'Передача в СДЭК',cdekAcceptedAt:'Приём СДЭК',cdekReturnedAt:'Возврат СДЭК',cdekStorageUntil:'Хранение СДЭК до',cdekRemittances:'Перечисления СДЭК',cdekHistoryRecovery:'Восстановление из реестра СДЭК',
 courier:'Доставка курьером',courierRecall:'Отзыв у курьера',courierRepackRequest:'Пересборка',shipmentReturn:'Запрос возврата отправления',shipmentChange:'Запрос изменения отправления',editRequest:'Запрос редактирования',cancellationRequest:'Запрос отмены',incompleteNameExplanation:'Пояснение неполного ФИО',
 paymentReceipt:'Приём оплаты',paymentReceivedAt:'Дата получения денег',paymentReceivedBy:'Кто принял деньги',paymentReceivedAmount:'Полученная сумма',premiumStage:'Этап премии',premiumNextPeriod:'Следующий период премии',importedPayment:'Перенесённая выплата',priorPremiumPaid:'Ранее выплаченная премия',legacyLv:'Данные ЛВ',skLeadId:'Номер Скорозвона',skWithoutProject:'Без проекта',testOnly:'Проверочный заказ',
 postalCode:'Индекс',region:'Регион',city:'Город',street:'Улица',house:'Дом',flat:'Квартира',name:'Название',quantity:'Количество',price:'Цена',code:'Код',amount:'Сумма',deliveryPoint:'ПВЗ',workTime:'Время работы',needsConfirmation:'Нужно подтверждение',min:'Минимальный срок',max:'Максимальный срок',account:'Аккаунт',slot:'Интервал',calculatedAt:'Дата расчёта',params:'Параметры',at:'Дата',by:'Сотрудник',text:'Текст',role:'Роль',id:'Номер',phase:'Этап',deadline:'Срок',completedAt:'Завершено',resolvedAt:'Решено',updatedAt:'Обновлено',from:'Было',to:'Стало',message:'Сообщение',changes:'Изменения',tracking:'Трек',registry:'Реестр',paymentDate:'Дата платежа',receivedAt:'Получено',operatorLogin:'Логин оператора',receivedByName:'Принял',source:'Источник',periodId:'Период',recordedAt:'Записано',
};
const delivery:Record<string,string>={cdek_pickup:'СДЭК · ПВЗ',cdek_courier:'СДЭК · Курьер',moscow_courier:'Москва · Курьер',russian_post:'Почта России'};
function equal(a:unknown,b:unknown):boolean{
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)!==Array.isArray(b))return false;
 const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x).filter(k=>!['context','revision'].includes(k)&&x[k]!==undefined);
 return keys.length===Object.keys(y).filter(k=>!['context','revision'].includes(k)&&y[k]!==undefined).length&&keys.every(k=>equal(x[k],y[k]));
}
export function orderChangeHistory(before:Order,after:Order,staff:Employee[]=[]):string[]{
 const value=(v:unknown,key:string):string=>{
  if(v===undefined||v===null||v==='')return 'не указано';
  if(typeof v==='boolean')return v?'да':'нет';
  if(typeof v==='string'){
   if(['manager','logistic','paymentReceivedBy','by'].includes(key))return staff.find(e=>e.id===v)?.name||v;
   if(key==='status')return statuses[v as keyof typeof statuses]||v;
   if(key==='delivery')return delivery[v]||v;
   if(key==='contact')return ({none:'Нет результата',missed:'Недозвон',callback:'Перезвон'} as Record<string,string>)[v]||v;
   if(key==='returnKind')return ({clarification:'Уточнение данных',refusal:'Отказ клиента',delivery:'Смена доставки'} as Record<string,string>)[v]||v;
   if(/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v)))return new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК';
   return v;
  }
  if(Array.isArray(v))return v.length?v.map(x=>key==='items'?`${x.name}: ${x.quantity} шт. × ${x.price} ₽`:value(x,key)).join('; '):'пусто';
  if(typeof v==='object')return Object.entries(v).filter(([k,x])=>!k.startsWith('_')&&!['context','revision'].includes(k)&&x!==undefined).map(([k,x])=>`${labels[k]||k}: ${value(x,k)}`).join('; ')||'пусто';
  return String(v);
 };
 // Only persisted business changes: revision counters and refresh timestamps are not user edits.
 const ignored=new Set(['id','version','updatedAt','timerCalendar']);
 return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>!k.startsWith('_')&&!ignored.has(k)).flatMap(key=>{
  const a=(before as unknown as Record<string,unknown>)[key],b=(after as unknown as Record<string,unknown>)[key];
  return equal(a,b)?[]:[`${labels[key]||key}: ${value(a,key)} → ${value(b,key)}`];
 });
}
export function withOrderChanges(text:string,before:Order,after:Order,staff:Employee[]=[]){
 const changes=orderChangeHistory(before,after,staff);
 return text+(changes.length?'\n'+changes.join('\n'):'');
}

export function visibleOrderHistoryText(text:string='',role:Employee['role']){
 const result=['admin','logistic','chief_logistic'].includes(role)?text:text.split('\n').filter(line=>!line.startsWith('Приём оплаты:')).join('\n');
 return ['operator','department_head'].includes(role)?result.replace(/(?<!\d)(?:\+?7|8)(?:[\s().-]*\d){10}(?!\d)/g,'[телефон]'):result;
}
