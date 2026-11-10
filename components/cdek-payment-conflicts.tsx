"use client";
import {money,type Order} from '@/lib/crm';
import {hasRemittanceConflict} from '@/lib/cdek-remittance';
export function CdekPaymentConflicts({orders}:{orders:Order[]}){
 const rows=orders.filter(o=>(o.cdekRemittances?.length||0)>1);
 if(!rows.length)return null;
 return <section className="stack table-panel cash-panel"><h2>СДЭК: повторные перечисления · {rows.length}</h2><p className="notice amber">При одинаковых суммах премия учитывается один раз по первому полученному реестру. Разные суммы требуют проверки администратора.</p>{rows.map(o=><div key={o.id}><h3>{o.id} · {hasRemittanceConflict(o)?'Разные суммы — требуется проверка':'Премия учитывается один раз'}</h3>{o.cdekRemittances!.map((r,i)=><p key={i}>{!hasRemittanceConflict(o)&&(i===0?'Учитывается · ':'Дубль — без начисления · ')}Аккаунт {r.slot} · реестр №{r.registry} · {r.paymentDate.split('-').reverse().join('.')} · {money(r.amountCents/100)} · накладная {r.tracking}</p>)}</div>)}</section>;
}
