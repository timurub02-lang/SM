import type {ActivityDb as Db} from './activity-store.ts';
import type {Employee} from './crm.ts';
import {redemptionDayAuthor,canSeeRedemption,dayOf,dayPlus,inRedemptionTab} from './redemption.ts';

// Keep membership after a result moves an order out of the work tab.
export async function redemptionDayCounts(d:Db,rows:any[],actor:Employee,headsAll:boolean,day=dayOf()){
 await d.prepare('CREATE TABLE IF NOT EXISTS redemption_workday_orders(day TEXT NOT NULL,order_id TEXT NOT NULL,morning INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(day,order_id))').run();
 const start=new Date(day+'T00:00:00+03:00').toISOString(),end=new Date(dayPlus(day,1)+'T00:00:00+03:00').toISOString();
 const archive=await d.prepare('SELECT data FROM redemption_archives WHERE day<? ORDER BY day DESC LIMIT 1').bind(day).first();
 const before=new Map<string,any>((JSON.parse(archive?.data||'[]') as any[]).map(r=>[r.order_id,r]));
 const events=(await d.prepare('SELECT order_id,at,data FROM redemption_history WHERE (at>=? AND at<?) OR id IN (SELECT MAX(id) FROM redemption_history WHERE at<? GROUP BY order_id) ORDER BY id').bind(start,end,start).all()).results;
 const today=new Map<string,any[]>();
 for(const h of events){const v=JSON.parse(h.data);if(h.at<start)before.set(h.order_id,v);else today.set(h.order_id,[...(today.get(h.order_id)||[]),v]);}
 const writes=[];
 for(const row of rows){
  if(row.entered_at>=end)continue;
  const changes=today.get(row.order_id)||[];
  let initial=before.get(row.order_id);
  if(!initial&&(!row.updatedAt||row.updatedAt<start))initial=row;
  // The first normal action was made from the work queue; return confirmation is a different queue.
  if(!initial&&changes.some(v=>v.changeKind==='action'&&v.result!=='returned'))initial={};
  const state=(v:any)=>({...v,entered_at:row.entered_at});
  const morning=row.entered_at<start&&initial!==undefined&&inRedemptionTab(state(initial),'work',day);
  const visited=morning||inRedemptionTab(row,'work',day)||changes.some(v=>inRedemptionTab(state(v),'work',day))||changes.some(v=>v.changeKind==='action'&&v.result!=='returned')||row.entered_at>=start;
  if(!visited)continue;
  const snapshot={order_id:row.order_id,manager:row.manager,department:row.department,author:row.author,lastDay:row.lastDay};
  writes.push(d.prepare('INSERT OR IGNORE INTO redemption_workday_orders(day,order_id,morning,data) VALUES(?,?,?,?)').bind(day,row.order_id,morning?1:0,JSON.stringify(snapshot)));
 }
 if(writes.length)await d.batch(writes);
 const saved=(await d.prepare('SELECT order_id,morning,data FROM redemption_workday_orders WHERE day=?').bind(day).all()).results;
 const current=new Map(rows.map(r=>[r.order_id,r]));
 const visible=saved.filter((r:any)=>canSeeRedemption(actor,JSON.parse(r.data),headsAll));
 const morning=visible.filter((r:any)=>r.morning).length;
 return {total:visible.length,morning,added:visible.length-morning,withoutAuthor:visible.filter((r:any)=>!redemptionDayAuthor(current.get(r.order_id)||JSON.parse(r.data),day).trim()).length};
}
