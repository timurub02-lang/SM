import type {Order} from './crm';
import {db} from './db';
import {orderRouting} from './cdek-routing-store';
import {cdekToken} from './cdek';

export async function operatorCdekToken(order:Pick<Order,'id'|'manager'|'items'>){
 const routing=await orderRouting(order);
 const slot=routing.choice?.slot||routing.accounts.find(account=>account.configured)?.slot;
 if(!slot)throw Error('Аккаунт СДЭК не подключён');
 const row=await db().prepare('SELECT data FROM settings WHERE id=?').bind('cdek-'+slot).first<{data:string}>();
 if(!row)throw Error('Аккаунт СДЭК не подключён');
 const keys=JSON.parse(row.data);
 return cdekToken(keys.clientId,keys.clientSecret);
}
