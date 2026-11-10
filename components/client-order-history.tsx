import {money,type Client,type Order} from '@/lib/crm';
import {clientHistoryEntries} from '@/lib/client-order-history';
const date=(value:string)=>new Date(value).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'});
export function ClientOrderHistory({client,orders}:{client:Client;orders:Order[]}){
 const rows=clientHistoryEntries(client.legacyOrderHistory||[],orders);
 if(!rows.length)return null;
 return <section className="stack" aria-label="История предыдущих заказов"><h3>История предыдущих заказов</h3>{rows.map(row=><article key={row.externalId} className="base-sheet-settings stack"><div className="section-title"><strong>ЛВ №{row.externalId}</strong><strong>{money(row.amount)}</strong></div><div><span className={row.status==='paid'?'badge mint':'badge amber'}>{row.status==='paid'?'Оплачен':'Возврат'}</span> <small>Создан {date(row.createdAt)}{row.completedAt&&` · ${row.status==='paid'?'Оплачен':'Возвращён'} ${date(row.completedAt)}`}</small></div>{row.items.map((item,i)=><div key={i}>{item.name}{item.quantity!==undefined&&` · ${item.quantity} шт.`}</div>)}</article>)}</section>;
}
