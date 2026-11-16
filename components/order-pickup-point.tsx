'use client';
import {useState} from 'react';
import {CdekPointSelect} from '@/components/cdek-point-select';
import {canSelectOrderPickupPoint,orderPickupPoint,type PickupPoint} from '@/lib/order-pickup-point';
import type {Order,Employee} from '@/lib/crm';
export function OrderPickupPoint({order,employee,staff,disabled,dirty,mutate}:{order:Order;employee:Employee;staff:Employee[];disabled:boolean;dirty:boolean;mutate:(p:Record<string,unknown>)=>Promise<boolean>}){
 const [points,setPoints]=useState<PickupPoint[]>([]),[selectionId,setSelectionId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!canSelectOrderPickupPoint(order,employee,staff))return null;
 const selected=orderPickupPoint(order);
 async function load(){setBusy(true);setError('');try{const r=await fetch('/api/cdek/pickup-points?'+new URLSearchParams({orderId:order.id,actorId:employee.id})),data=await r.json() as {points:PickupPoint[];selectionId:string;error?:string};if(!r.ok)throw Error(data.error||'Не удалось загрузить ПВЗ');setPoints(data.points);setSelectionId(data.selectionId);}catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить ПВЗ');}finally{setBusy(false);}}
 return <section id="order-pickup-point" className="stack order-note"><h3>ПВЗ получателя</h3><p>Выберите пункт до передачи логисту. Логист увидит выбранный адрес и проверит его при расчёте доставки.</p>{selected&&<p className="notice">{selected.code} · {selected.address}<br/>{selected.workTime}</p>}<fieldset className="stack" disabled={disabled||busy||dirty}><button type="button" className="secondary" onClick={()=>void load()}>{busy?'Загрузка…':'Загрузить ПВЗ'}</button><CdekPointSelect points={points} value={selected?.code||''} savedLabel={selected?selected.code+' · '+selected.address:undefined} onChange={async code=>{if(!code)return;setBusy(true);setError('');try{await mutate({action:'selectOrderPickupPoint',id:order.id,version:order.version,code,selectionId});}finally{setBusy(false);}}}/></fieldset>{dirty&&<p>Сначала сохраните адрес, способ доставки и корзину.</p>}{error&&<p role="alert" className="orange">{error}</p>}{selectionId&&!points.length&&<p>По этому индексу ПВЗ не найдены. Проверьте адрес.</p>}</section>;
}
