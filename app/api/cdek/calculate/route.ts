import {rankRecipientPoints} from '@/lib/cdek-points';
import {readLimitedText} from '@/lib/request-body';
import {orderRouting} from '@/lib/cdek-routing-store';
import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {cdekToken} from '@/lib/cdek';
import {calculationError,calculationSchema,calculationPayload,tariffMode,canManageDelivery} from '@/lib/cdek-calculator';
import type {Order} from '@/lib/crm';
import {z} from 'zod';
async function handlePOST(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
  const raw=await readLimitedText(req,12000);if(raw.length>3000)throw Error('Слишком большой запрос');const p=calculationSchema.parse(JSON.parse(raw));
  const employee=await db().prepare('SELECT data FROM employees WHERE id=?').bind(p.actorId).first<{data:string}>();
  const row=await db().prepare('SELECT data FROM orders WHERE id=?').bind(p.orderId).first<{data:string}>();
  if(!row)return Response.json({error:'Заказ не найден'},{status:404});
  const order=JSON.parse(row.data) as Order;
  if(!employee||!canManageDelivery(JSON.parse(employee.data).role,order.status))return Response.json({error:'Расчёт доступен логисту до отправки заказа'},{status:403});
  const routing=await orderRouting(order);if(routing.choice)p.slot=routing.choice.slot;
  const payload=calculationPayload(p,order.addressParts?.postalCode||'');
  const config=await db().prepare('SELECT data FROM settings WHERE id=?').bind(`cdek-${p.slot}`).first<{data:string}>();
  if(!config)return Response.json({error:'Выбранный аккаунт СДЭК не подключён'},{status:409});
  const keys=JSON.parse(config.data);const token=await cdekToken(keys.clientId,keys.clientSecret);
  let deliveryPoint:{code:string;address:string;workTime:string}|undefined;
  if(p.delivery==='cdek_pickup'){
   const query=new URLSearchParams({type:'PVZ',country_code:'RU',postal_code:order.addressParts?.postalCode||'',is_handout:'true',weight_max:String(Math.ceil(p.weight)),length:String(p.length),width:String(p.width),height:String(p.height)});
   const response=await fetch(`https://api.cdek.ru/v2/deliverypoints?${query}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
   const data=await response.json();
   if(!response.ok||!Array.isArray(data))throw Error('СДЭК: не удалось загрузить ПВЗ. Повторите попытку');
   const points=rankRecipientPoints(data.filter(x=>x.status==='ACTIVE'&&x.is_handout).map(x=>({code:x.code,address:x.location?.address_full||x.location?.address||x.code,postalCode:x.location?.postal_code,workTime:x.work_time||''})),order.addressParts);
   if(p.action==='points')return Response.json({points},{headers:{'Cache-Control':'no-store'}});
   const point=points.find(x=>x.code===p.deliveryPoint);
   if(!point)throw Error('СДЭК: выберите доступный ПВЗ получателя перед расчётом');
   deliveryPoint={code:point.code,address:point.address,workTime:point.workTime};
  }
  const response=await fetch('https://api.cdek.ru/v2/calculator/tarifflist',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>({})) as {tariff_codes?:{tariff_code:number;tariff_name:string;delivery_mode:number;delivery_sum:number;period_min:number;period_max:number;currency?:string}[];errors?:{code?:string}[]};
  if(!response.ok||data.errors?.length)throw Error(calculationError(response.status,data.errors));
  const tariffs=(data.tariff_codes||[]).filter(t=>t.delivery_mode===tariffMode(p)&&Number.isFinite(t.delivery_sum)).map(t=>({code:t.tariff_code,name:t.tariff_name,amount:t.delivery_sum,min:t.period_min,max:t.period_max,currency:t.currency||'RUB'})).sort((a,b)=>a.amount-b.amount);
  const quote={id:crypto.randomUUID(),tariffs,account:keys.name,calculatedAt:new Date().toISOString(),params:p,deliveryPoint,address:order.address,addressParts:order.addressParts,items:order.items};
  await db().prepare('INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(`cdek-quote-${order.id}`,JSON.stringify(quote)).run();
  return Response.json({tariffs,account:quote.account,calculatedAt:quote.calculatedAt,quoteId:quote.id},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте индекс, вес и размеры посылки':e instanceof Error&&e.message==='Заполните индекс получателя в адресе заказа'?e.message:e instanceof Error&&e.message.startsWith('СДЭК')?e.message:'Не удалось рассчитать доставку. Попробуйте ещё раз.'},{status:400});}
}

export const POST=authenticated(handlePOST);
