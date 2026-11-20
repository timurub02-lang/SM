import type {ActivityDb} from './activity-store.ts';
import type {IncomingMiss} from './crm.ts';

export async function initMissedHistory(d:ActivityDb){
 if(await d.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='incoming_log_missed'").first())return;
 const hasEvents=await d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='events'").first();
 await d.batch([
  d.prepare(`CREATE TABLE IF NOT EXISTS incoming_missed_history(
   incoming_id TEXT NOT NULL REFERENCES incoming_calls(id) ON DELETE CASCADE,
   at TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, call_id TEXT,
   PRIMARY KEY(incoming_id,at))`),
  // Older client events have no request ID. Only recover events inside exactly one matching request.
  ...(hasEvents?[d.prepare(`INSERT OR IGNORE INTO incoming_missed_history(incoming_id,at,actor_id,actor_name)
   SELECT min(i.id),e.at,json_extract(e.data,'$.actorId'),coalesce(json_extract(e.data,'$.actor'),'')
   FROM events e JOIN incoming_calls i ON i.client_id=e.client_id AND i.at<=e.at
    AND i.missed_at>=e.at AND (i.closed_at IS NULL OR i.closed_at>=e.at)
   WHERE e.id GLOB 'INCOMING-ND-*' AND json_extract(e.data,'$.actorId') IS NOT NULL
   GROUP BY e.id HAVING count(*)=1`)]:[]),
  d.prepare(`INSERT OR IGNORE INTO incoming_missed_history(incoming_id,at,actor_id,actor_name)
   SELECT i.id,i.missed_at,i.missed_by,coalesce(json_extract(e.data,'$.name'),'')
   FROM incoming_calls i LEFT JOIN employees e ON e.id=i.missed_by WHERE i.missed_at<>''`),
  // Capture the successful state change, including writes from a draining web slot.
  d.prepare(`CREATE TRIGGER IF NOT EXISTS incoming_log_missed AFTER UPDATE OF missed_at ON incoming_calls
   WHEN NEW.missed_at<>'' AND NEW.missed_at<>OLD.missed_at BEGIN
    INSERT INTO incoming_missed_history(incoming_id,at,actor_id,actor_name)
    VALUES(NEW.id,NEW.missed_at,NEW.missed_by,coalesce((SELECT json_extract(data,'$.name') FROM employees WHERE id=NEW.missed_by),''));
   END`),
  d.prepare('CREATE INDEX IF NOT EXISTS phone_call_incoming_request ON phone_call_incoming(incoming_id)')
 ]);
}

// With no explicit call ID, use only a unique call from this request and employee in this attempt.
const attemptCall=`COALESCE(h.call_id,(SELECT CASE WHEN count(*)=1 THEN min(p.id) END
 FROM phone_call_incoming link JOIN phone_calls p ON p.id=link.call_id
 WHERE link.incoming_id=h.incoming_id AND p.actor_id=h.actor_id AND p.started_at<=h.at
 AND p.started_at>coalesce((SELECT max(prev.at) FROM incoming_missed_history prev
  WHERE prev.incoming_id=h.incoming_id AND prev.at<h.at),'')
 AND julianday(coalesce(p.ended_at,p.started_at))>=julianday(h.at,'-10 minutes')))`;

export async function readMissedHistory(d:ActivityDb,ids:string[]){
 const history=new Map<string,IncomingMiss[]>();
 if(!ids.length)return history;
 const {results}=await d.prepare(`SELECT h.incoming_id,h.at,h.actor_name,p.id AS recording
  FROM incoming_missed_history h LEFT JOIN phone_calls p ON p.id=${attemptCall} AND p.recording=1
  WHERE h.incoming_id IN (SELECT value FROM json_each(?)) ORDER BY h.at DESC`).bind(JSON.stringify(ids)).all();
 for(const row of results){
  const entries=history.get(row.incoming_id)??[];
  entries.push({at:row.at,name:row.actor_name,recording:row.recording||undefined});
  history.set(row.incoming_id,entries);
 }
 return history;
}
