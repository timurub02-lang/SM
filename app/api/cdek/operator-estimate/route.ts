import {getChatGPTUser} from '@/app/chatgpt-auth';
import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import {canPreviewOrderDelivery,orderPickupPoint,orderPostalCode,selectedCachedPickupPoint,type PickupPoint} from '@/lib/order-pickup-point';
import {operatorCdekToken} from '@/lib/cdek-operator-account';
import {calculationPayload,cdekParcelWeight,tariffMode} from '@/lib/cdek-calculator';
import {isBasketTotal} from '@/lib/basket-total';
import {parcelDefaults,type Product} from '@/lib/warehouse';
import {assignedClients,itemsSchemaFor,type Client,type Employee,type Order} from '@/lib/crm';
import {incomingForAction} from '@/lib/incoming';
import {readLimitedText} from '@/lib/request-body';
import {z} from 'zod';

const unavailable=()=>Response.json({min:null,max:null},{headers:{'Cache-Control':'no-store'}});
async function staffList(){
 return (await db().prepare('SELECT data FROM employees').all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Employee);
}

export const GET=authenticated(async(req:Request)=>{
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const query=new URL(req.url).searchParams;
 const orderId=query.get('orderId'),delivery=query.get('delivery');
 if(!orderId||(delivery!=='cdek_pickup'&&delivery!=='cdek_courier'))return Response.json({error:'Проверьте способ доставки'},{status:400});
 const d=db();
 const row=await d.prepare('SELECT data FROM orders WHERE id=?').bind(orderId).first<{data:string}>();
 if(!row)return Response.json({error:'Заказ не найден'},{status:404});
 const order:Order=JSON.parse(row.data);
 const staff=await staffList();
 const actor=staff.find(e=>e.id===query.get('actorId'));
 if(!actor||!canPreviewOrderDelivery(order,actor,staff))return Response.json({error:'Заказ недоступен'},{status:403});
 try{
  let destination=orderPostalCode(order);
  if(delivery==='cdek_pickup'){
   const code=query.get('point'),selection=query.get('selection');
   let point:PickupPoint|undefined=orderPickupPoint(order);
   if(order.delivery!=='cdek_pickup'||!code)throw Error();
   if(selection){
    const cache=await d.prepare('SELECT data FROM settings WHERE id=?').bind('cdek-pickup-options-'+orderId).first<{data:string}>();
    point=selectedCachedPickupPoint(order,cache&&JSON.parse(cache.data),code,selection,Date.now());
   }
   if(point?.code!==code)throw Error();
   destination=point.postalCode||destination;
  }
  return await estimate(order,destination,delivery);
 }catch{return unavailable();}
});

const draftSchema=z.object({clientId:z.string().min(1).max(100),actorId:z.string().min(1).max(100),items:itemsSchemaFor(true),incomingId:z.string().min(1).max(100).optional()});
export const POST=authenticated(async(req:Request)=>{
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const parsed=draftSchema.safeParse(JSON.parse(await readLimitedText(req,65000)));
 if(!parsed.success)return Response.json({error:'Проверьте корзину'},{status:400});
 const draft=parsed.data,d=db(),staff=await staffList();
 const actor=staff.find(e=>e.id===draft.actorId);
 if(!actor||!['operator','department_head','admin'].includes(actor.role))return Response.json({error:'Нет доступа'},{status:403});
 const row=await d.prepare('SELECT data FROM clients WHERE id=?').bind(draft.clientId).first<{data:string}>();
 if(!row)return Response.json({error:'Нет доступа'},{status:403});
 const client:Client=JSON.parse(row.data);
 const incoming=draft.incomingId?await incomingForAction(d,draft.incomingId,actor,staff,client.id).catch(()=>null):null;
 if(!incoming&&actor.role!=='admin'&&!assignedClients([client],staff,actor).length)return Response.json({error:'Нет доступа'},{status:403});
 try{
  return await estimate({id:'',manager:client.owner||incoming?.assignee_id||actor.id,items:draft.items},orderPostalCode(client),'cdek_courier');
 }catch{return unavailable();}
});

async function estimate(order:Pick<Order,'id'|'manager'|'items'>,destination:string,delivery:'cdek_pickup'|'cdek_courier'){
  const d=db();
  const origin=await d.prepare("SELECT json_extract(data,'$.postalCode') postal FROM settings WHERE id='warehouse-address'").first<{postal:string}>();
  if(!origin||!/^\d{6}$/.test(origin.postal)||!/^\d{6}$/.test(destination))throw Error();
  const products=(await d.prepare('SELECT data FROM products').all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Product);
  const parcel=parcelDefaults(order.items.filter(item=>!isBasketTotal(item)),products);
  // CDEK accepts weight alone when warehouse dimensions are unavailable.
  const params={originPostalCode:origin.postal,weight:cdekParcelWeight,length:parcel?.length||undefined,width:parcel?.width||undefined,height:parcel?.height||undefined};
  const payload=calculationPayload(params,destination);
  const mode=tariffMode({delivery,originMode:parcel?.originMode||'warehouse'});
  const token=await operatorCdekToken(order);
  const res=await fetch('https://api.cdek.ru/v2/calculator/tarifflist',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!res.ok)throw Error();
  type Tariff={delivery_mode:number;delivery_sum:number;period_min:number;period_max:number};
  const data=await res.json() as {tariff_codes?:Tariff[];errors?:unknown[]};
  const tariffs:Tariff[]=data.tariff_codes||[];
  const best=tariffs.filter(t=>t.delivery_mode===mode&&Number.isFinite(t.delivery_sum)&&t.delivery_sum>=0&&Number.isInteger(t.period_min)&&t.period_min>=0&&Number.isInteger(t.period_max)&&t.period_max>=t.period_min).sort((a,b)=>a.delivery_sum-b.delivery_sum)[0];
  if(!best||data.errors?.length)throw Error();
  return Response.json({min:best.period_min,max:best.period_max},{headers:{'Cache-Control':'no-store'}});
}
