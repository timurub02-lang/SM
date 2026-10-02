import {db} from './db';
import {cashSchema} from './cash';
export async function initCash(){await db().batch(cashSchema.map(sql=>db().prepare(sql)));}
