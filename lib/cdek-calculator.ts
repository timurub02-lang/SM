import {z} from 'zod';
export const calculationSchema=z.object({actorId:z.string().min(1),orderId:z.string().min(1),slot:z.number().int().min(1).max(4),delivery:z.enum(['cdek_pickup','cdek_courier']),originPostalCode:z.string().regex(/^\d{6}$/,'Укажите индекс отправления из 6 цифр'),originMode:z.enum(['warehouse','door']),weight:z.number().positive().max(1000000),length:z.number().int().positive().max(1000),width:z.number().int().positive().max(1000),height:z.number().int().positive().max(1000)});
export type CalculationInput=z.infer<typeof calculationSchema>;
export const canManageDelivery=(role:string,status:string)=>['admin','logistic'].includes(role)&&['draft','rework','confirm','extra','check','packing','phone'].includes(status);
export const tariffMode=(p:Pick<CalculationInput,'originMode'|'delivery'>)=>p.originMode==='warehouse'?(p.delivery==='cdek_pickup'?4:3):(p.delivery==='cdek_pickup'?2:1);
export function calculationPayload(p:CalculationInput,destinationPostalCode:string){
 if(!/^\d{6}$/.test(destinationPostalCode))throw new Error('Заполните индекс получателя в адресе заказа');
 return {type:1,currency:1,lang:'rus',from_location:{postal_code:p.originPostalCode,country_code:'RU'},to_location:{postal_code:destinationPostalCode,country_code:'RU'},packages:[{weight:Math.ceil(p.weight*1000),length:p.length,width:p.width,height:p.height}]};
}
export function calculationError(status:number,errors?:{code?:string}[]){
 const code=errors?.[0]?.code;
 const messages:Record<string,string>={v2_sender_location_not_recognized:'не удалось определить город отправления. Проверьте индекс отправления',v2_recipient_location_not_recognized:'не удалось определить город получателя. Проверьте индекс в адресе заказа',v2_invalid_format:'неверный формат параметров расчёта',v2_field_is_empty:'не заполнен обязательный параметр',v2_tariff_forbidden:'тариф недоступен для выбранного договора',v2_token_expired:'истёк срок авторизации. Повторите расчёт',v2_bad_gateway:'сервис расчёта временно недоступен. Повторите позже'};
 const safeCode=typeof code==='string'&&/^[a-zA-Z0-9_]{1,100}$/.test(code)?code:'';
 return `СДЭК: ${messages[safeCode]||(status===429?'слишком много запросов. Повторите позже':status>=500?'временная ошибка сервиса. Повторите позже':'расчёт отклонён. Проверьте индексы и параметры посылки')}${safeCode?` (${safeCode})`:` (HTTP ${status})`}.`;
}
