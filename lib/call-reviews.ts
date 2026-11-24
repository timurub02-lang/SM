import type {ActivityDb} from './activity-store.ts';
import {initReplacement} from './phone-replacement.ts';

const ready = new WeakMap<ActivityDb,Promise<void>>();
export async function initReviews(d:ActivityDb) {
  let pending = ready.get(d);
  if (!pending) {
    pending = (async () => {
      await initReplacement(d);
      await d.batch([
        d.prepare('CREATE TABLE IF NOT EXISTS call_reviews(source TEXT NOT NULL,call_id TEXT NOT NULL,reviewer TEXT NOT NULL,reviewer_name TEXT NOT NULL,reviewed_at TEXT NOT NULL,note TEXT NOT NULL,revision TEXT NOT NULL,PRIMARY KEY(source,call_id))'),
        d.prepare('CREATE INDEX IF NOT EXISTS phone_recordings_by_date ON phone_calls(started_at DESC,id) WHERE recording=1'),
        d.prepare('CREATE INDEX IF NOT EXISTS replacement_recordings_by_date ON replacement_calls(claimed_at DESC,id) WHERE recording=1'),
      ]);
    })().catch(error => {ready.delete(d);throw error;});
    ready.set(d,pending);
  }
  await pending;
}

export type ReviewRow = {source:'phone'|'masked';id:string;at:string;client:string;name:string;orderId:string|null;employee:string;seconds:number;note:string|null;reviewedAt:string|null;reviewer:string|null;revision:string|null};
const calls = `SELECT 'phone' source,p.id,p.started_at at,coalesce(p.client_id,o.client_id) client,p.order_id orderId,p.actor_name employee,p.bill_seconds seconds
 FROM phone_calls p LEFT JOIN orders o ON o.id=p.order_id WHERE p.recording=1 AND (p.order_id IS NOT NULL OR p.client_id IS NOT NULL)
 UNION ALL SELECT 'masked',p.id,p.claimed_at,a.client_id,p.order_id,'Подменный номер',p.bill_seconds
 FROM replacement_calls p JOIN replacement_assignments a ON a.id=p.assignment_id WHERE p.recording=1`;

// SQLite's built-in lower() only folds ASCII. Use a bound GLOB pattern for Russian names.
function contains(text:string) {
  return '*'+Array.from(text,c=>/[ёе]/i.test(c)?'[еЕёЁ]':/[а-яa-z]/i.test(c)?'['+c.toLowerCase()+c.toUpperCase()+']':c==='['?'[[]':c==='*'?'[*]':c==='?'?'[?]':c).join('')+'*';
}
export async function reviewPage(d:ActivityDb, params:URLSearchParams) {
  await initReviews(d);
  const where:string[]=[], args:(string|number)[]=[];
  for(const [param,col] of [['client','q.client'],['order','q.orderId']]){
    const value=params.get(param);if(value){where.push(col+'=?');args.push(value);}
  }
  const term=(params.get('q')||'').trim().slice(0,100);
  if(term){
    const pattern=contains(term);
    let match="json_extract(c.data,'$.name') GLOB ? OR q.orderId GLOB ?";
    args.push(pattern,pattern);
    if(/^[+\d\s()-]+$/.test(term)){
      const digits=term.replace(/\D/g,'').replace(/^8(?=\d{10}$)/,'7');
      if(digits){match+=' OR q.client IN (SELECT client_id FROM client_phone_index WHERE instr(phone,?)>0)';args.push(digits);}
    }
    where.push('('+match+')');
  }
  const employee=params.get('employee')?.trim();if(employee){where.push('q.employee GLOB ?');args.push(contains(employee.slice(0,100)));}
  for(const [key,op,day] of [['from','>=',0],['until','<',1]] as const){
    const value=params.get(key);if(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Неверная дата');where.push('q.at '+op+' ?');args.push(new Date(Date.parse(value+'T00:00:00+03:00')+day*86400000).toISOString());}
  }
  const base=` FROM (${calls}) q LEFT JOIN clients c ON c.id=q.client LEFT JOIN call_reviews r ON r.source=q.source AND r.call_id=q.id WHERE ${where.join(' AND ')||'1'}`;
  const filter=params.get('status')==='done'?'IS NOT NULL':'IS NULL';
  const offset=Math.max(0,Number(params.get('offset'))||0);
  if(!Number.isSafeInteger(offset))throw Error('Неверная страница');
  const [counts,page]=await Promise.all([
    d.prepare('SELECT count(*) total,count(r.call_id) done'+base).bind(...args).first(),
    d.prepare(`SELECT q.*,json_extract(c.data,'$.name') name,r.reviewed_at reviewedAt,r.reviewer_name reviewer,r.note,r.revision`+base+` AND r.call_id ${filter} ORDER BY q.at DESC,q.id,q.source LIMIT 26 OFFSET ?`).bind(...args,offset).all()
  ]);
  return {rows:page.results.slice(0,25) as ReviewRow[],more:page.results.length>25,done:counts.done,pending:counts.total-counts.done};
}

export async function writeReview(d:ActivityDb,source:ReviewRow['source'],id:string,note:string,revision:string|null,actor:{id:string;name:string}) {
  await initReviews(d);
  const next=crypto.randomUUID();
  const exists=source==='masked'?'SELECT 1 FROM replacement_calls WHERE id=? AND recording=1':'SELECT 1 FROM phone_calls WHERE id=? AND recording=1 AND (client_id IS NOT NULL OR order_id IS NOT NULL)';
  const result=revision
    ?await d.prepare(`UPDATE call_reviews SET note=?,revision=? WHERE source=? AND call_id=? AND revision=? AND EXISTS(${exists})`).bind(note,next,source,id,revision,id).run()
    :await d.prepare(`INSERT OR IGNORE INTO call_reviews(source,call_id,reviewer,reviewer_name,reviewed_at,note,revision) SELECT ?,?,?,?,?,?,? WHERE EXISTS(${exists})`).bind(source,id,actor.id,actor.name,new Date().toISOString(),note,next,id).run();
  return !!result.meta.changes;
}
