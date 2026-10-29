"use client";
import {money,type Order} from '@/lib/crm';
export function CdekPaymentConflicts({orders}:{orders:Order[]}){
 const rows=orders.filter(o=>(o.cdekRemittances?.length||0)>1);
 if(!rows.length)return null;
 return <section className="stack table-panel cash-panel"><h2>СДЭК: проверить перечисления · {rows.length}</h2><p className="notice amber">По этим заказам получено несколько положительных перечислений или изменились данные реестра. Не включайте их в выплату премии до проверки. Повторный реестр не означает новую премию за заказ.</p>{rows.map(o=><div key={o.id}><h3>{o.id}</h3>{o.cdekRemittances!.map((r,i)=><p key={i}>Аккаунт {r.slot} · реестр №{r.registry} · {r.paymentDate.split('-').reverse().join('.')} · {money(r.amountCents/100)} · накладная {r.tracking}</p>)}</div>)}</section>;
}
