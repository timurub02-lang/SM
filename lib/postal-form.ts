import {z} from 'zod';
import {orderTracking} from './order-tracking.ts';
import {total,type Client,type Order} from './crm.ts';

const text=z.string().trim().min(1,'Заполните поле');
export const postalSenderSchema=z.object({
 name:text.max(250),address:text.max(500),
 postalCode:z.string().trim().regex(/^\d{6}$/,'Индекс должен содержать 6 цифр'),
 phone:z.string().trim().max(30).refine(v=>!v||/^[+\d\s()-]+$/.test(v)&&v.replace(/\D/g,'').length>=10,'Проверьте телефон'),
});
export type PostalParty=z.infer<typeof postalSenderSchema>;
export const emptyPostalSender:PostalParty={name:'',address:'',postalCode:'',phone:''};
export type PostalFormData={id:string;amount:number;trackingNumber?:string;sender:PostalParty;recipient:PostalParty};

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
 const amount=total(order);
 if(!Number.isSafeInteger(Math.round(amount*100))||amount<0)throw Error('Проверьте сумму заказа для почтового бланка');
 return {id:order.id,amount,trackingNumber:orderTracking(order)?.number,sender:postalSenderSchema.parse(sender),recipient};
}

function plural(value:number,forms:readonly string[]){
 const lastTwo=value%100,last=value%10;
 if(lastTwo>=11&&lastTwo<=14)return forms[2];
 if(last===1)return forms[0];
 if(last>=2&&last<=4)return forms[1];
 return forms[2];
}
export function postalAmountText(amount:number){
 const cents=Math.round(amount*100);
 if(typeof amount!=='number'||!Number.isSafeInteger(cents)||cents<0)throw Error('Проверьте сумму заказа для почтового бланка');
 const rubles=Math.floor(cents/100),kopeks=cents%100,words:string[]=[];
 const small=['','один','два','три','четыре','пять','шесть','семь','восемь','девять','десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
 const tens=['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
 const hundreds=['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
 const scales=[[],['тысяча','тысячи','тысяч'],['миллион','миллиона','миллионов'],['миллиард','миллиарда','миллиардов'],['триллион','триллиона','триллионов']];
 for(let scale=scales.length-1;scale>=0;scale--){
  const group=Math.floor(rubles/1000**scale)%1000;
  if(!group)continue;
  if(group>=100)words.push(hundreds[Math.floor(group/100)]);
  const remainder=group%100;
  if(remainder>=20)words.push(tens[Math.floor(remainder/10)]);
  const units=remainder<20?remainder:remainder%10;
  if(units)words.push(scale===1&&units<=2?['','одна','две'][units]:small[units]);
  if(scale)words.push(plural(group,scales[scale]));
 }
 if(!words.length)words.push('ноль');
 words.push(plural(rubles,['рубль','рубля','рублей']));
 if(kopeks)words.push(String(kopeks).padStart(2,'0'),plural(kopeks,['копейка','копейки','копеек']));
 const written=words.join(' '),numeric=(cents/100).toLocaleString('ru-RU',{minimumFractionDigits:kopeks?2:0,maximumFractionDigits:2});
 return numeric+' руб. ('+written[0].toUpperCase()+written.slice(1)+')';
}
