import {db} from './db';
import {initCashNotifications} from './cash-notifications';
import {cashSchema} from './cash';
export async function initCash(){await db().batch(cashSchema.map(sql=>db().prepare(sql)));await initCashNotifications(db());}
