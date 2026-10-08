import {z} from 'zod';
import type {Client,Order} from './crm.ts';

const text=z.string().trim().min(1,'Заполните поле');
export const postalSenderSchema=z.object({
 name:text.max(250),address:text.max(500),
 postalCode:z.string().trim().regex(/^\d{6}$/,'Индекс должен содержать 6 цифр'),
 phone:z.string().trim().max(30).refine(v=>!v||/^[+\d\s()-]+$/.test(v)&&v.replace(/\D/g,'').length>=10,'Проверьте телефон'),
});
export type PostalParty=z.infer<typeof postalSenderSchema>;
export const emptyPostalSender:PostalParty={name:'',address:'',postalCode:'',phone:''};
export const postalMoneyPlaceholders={declaredValue:'Уточнить_1',cashOnDelivery:'Уточнить_2'} as const;
export type PostalFormData={id:string;sender:PostalParty;recipient:PostalParty};

export function postalFormData(order:Order,client:Client,sender:PostalParty):PostalFormData{
 if(order.delivery!=='russian_post')throw Error('Почтовый бланк доступен только для Почты России');
 if(!postalSenderSchema.safeParse(sender).success)throw Error('Администратору нужно заполнить отправителя в настройках раздела «Почта России»');
 const address=(order.address??client.address).trim();
 // An explicitly emptied order index must not be replaced by the client's old index.
 const parts=order.addressParts??(order.address===undefined||order.address===client.address?client.addressParts:undefined);
 const postalCode=(parts?parts.postalCode:address.match(/^\d{6}(?=\s|,)/)?.[0]||'').trim();
 if(!/^\d{6}$/.test(postalCode))throw Error('В адресе заказа нужен почтовый индекс из 6 цифр. Заполните его во вкладке «Адрес и товары» и сохраните заказ.');
 const recipient={name:client.name.trim(),phone:client.phone.trim(),postalCode,address:address.replace(new RegExp(`^${postalCode}[,\\s]+`),'')};
 if(!postalSenderSchema.safeParse(recipient).success)throw Error('Проверьте ФИО, телефон и адрес получателя в заказе и карточке клиента');
 return {id:order.id,sender:postalSenderSchema.parse(sender),recipient};
}
