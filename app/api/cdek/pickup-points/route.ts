import {getChatGPTUser} from '@/app/chatgpt-auth';
import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import {canSelectOrderPickupPoint,pickupPointContext,orderPostalCode} from '@/lib/order-pickup-point';
import {operatorCdekToken} from '@/lib/cdek-operator-account';
import {eligibleRecipientPoint,rankRecipientPoints} from '@/lib/cdek-points';
import {parcelDefaults,type Product} from '@/lib/warehouse';
import type {Order,Employee} from '@/lib/crm';
import {z} from 'zod';
export const GET=authenticated(async(req:Request)=>{
 if(!await getChatGPTUser())return Response.json({error:"Требуется вход"},{status:401});
 try{
 const q=new URL(req.url).searchParams,orderId=z.string().min(1).max(100).parse(q.get('orderId')),actor=q.get('actorId');const d=db();
 const row=await d.prepare('SELECT data FROM orders WHERE id=?').bind(orderId).first<{data:string}>();if(!row)return Response.json({error:'Заказ не найден'},{status:404});
 const o=JSON.parse(row.data) as Order,staff=(await d.prepare('SELECT data FROM employees').all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Employee),e=staff.find(x=>x.id===actor);
 if(!e||!canSelectOrderPickupPoint(o,e,staff))return Response.json({error:'Выбор ПВЗ недоступен для этого заказа'},{status:403});
 const postalCode=orderPostalCode(o);
 if(!/^\d{6}$/.test(postalCode))throw Error('Сохраните адрес с индексом получателя из 6 цифр');
 const token=await operatorCdekToken(o);
 const products=(await d.prepare('SELECT data FROM products').all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Product),parcel=parcelDefaults(o.items,products);
 const query=new URLSearchParams({type:'PVZ',country_code:'RU',postal_code:postalCode,is_handout:'true',allowed_cod:'true',weight_max:'1'});
 if(parcel)for(const key of ['length','width','height'] as const)if(parcel[key])query.set(key,String(parcel[key]));
 const response=await fetch('https://api.cdek.ru/v2/deliverypoints?'+query,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)}),data=await response.json();if(!response.ok||!Array.isArray(data))throw Error('Не удалось загрузить ПВЗ СДЭК. Повторите попытку');
 const points=rankRecipientPoints(data.filter(eligibleRecipientPoint).map(p=>({code:p.code,address:p.location?.address_full||p.location?.address||p.code,postalCode:p.location?.postal_code,workTime:p.work_time||'',allowedCod:true})),{...o.addressParts,postalCode});
 const selectionId=crypto.randomUUID();await d.prepare('INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind('cdek-pickup-options-'+orderId,JSON.stringify({id:selectionId,context:pickupPointContext(o),points,expiresAt:Date.now()+1800000})).run();
 return Response.json({points,selectionId},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Не удалось загрузить ПВЗ'},{status:400});}
});
