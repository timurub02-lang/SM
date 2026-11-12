import type {State} from './crm.ts';
export const entityFields=['clients','orders','employees','events'] as const;
export type EntityField=typeof entityFields[number];
export type CrmStateDelta={kind:'crm-delta';meta:Omit<State,EntityField>;entities:Record<EntityField,{upsert:{id:string}[];ids:string[]}>};
export function decodeCrmSnapshot<T extends State>(value:T|CrmStateDelta,previous?:T):T{
 if(!('kind' in value)||value.kind!=='crm-delta')return value as T;
 if(!previous)throw Error('Не удалось восстановить обновление. Обновите страницу.');
 const next={...value.meta} as T;
 for(const field of entityFields){
  const change=value.entities[field],byId=new Map<string,any>(previous[field].map(row=>[row.id,row]));
  for(const row of change.upsert)byId.set(row.id,row);
  (next[field] as {id:string}[])=change.ids.map(id=>{const row=byId.get(id);if(!row)throw Error('Неполное обновление CRM');return row;});
 }
 return next;
}
