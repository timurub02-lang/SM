import type {ActivityDb as Db} from './activity-store.ts';
export async function initBaseMovements(d:Db){
 const sheet=(row:string)=>{const source=`COALESCE(json_extract(${row}.data,'$.source'),'')`;const raw=`COALESCE(json_extract(${row}.data,'$.sheet'),CASE WHEN instr(lower(${source}),'.xlsx · ')>0 THEN substr(${source},instr(lower(${source}),'.xlsx · ')+8) ELSE '' END)`;return `CASE WHEN ${raw} IN ('ТК','ТКП') THEN 'П' ELSE ${raw} END`;};
 const base=(row:string)=>`CASE WHEN json_extract(${row}.data,'$.baseType')='J' THEN 'J' ELSE 'M' END`;
 await d.batch([
  d.prepare('CREATE TABLE IF NOT EXISTS base_movements(id INTEGER PRIMARY KEY,client_id TEXT NOT NULL,at TEXT NOT NULL,from_base TEXT NOT NULL,to_base TEXT NOT NULL,from_sheet TEXT NOT NULL,to_sheet TEXT NOT NULL)'),
  d.prepare('CREATE INDEX IF NOT EXISTS base_movements_at ON base_movements(at)'),
  d.prepare(`CREATE TRIGGER IF NOT EXISTS base_movement_update AFTER UPDATE OF data ON clients WHEN ${base('OLD')}<>${base('NEW')} OR ${sheet('OLD')}<>${sheet('NEW')} BEGIN INSERT INTO base_movements(client_id,at,from_base,to_base,from_sheet,to_sheet) VALUES(NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),${base('OLD')},${base('NEW')},${sheet('OLD')},${sheet('NEW')}); END`),
  d.prepare("INSERT OR IGNORE INTO settings(id,data) VALUES('base-movements-start',json_object('at',strftime('%Y-%m-%dT%H:%M:%fZ','now')))")
 ]);
}
export async function dailyBaseMovements(d:Db,now=Date.now()){
 await initBaseMovements(d);
 const day=new Date(now+3*3600000).toISOString().slice(0,10),start=new Date(day+'T00:00:00+03:00').toISOString(),end=new Date(Date.parse(start)+86400000).toISOString();
 const rows=(await d.prepare('SELECT from_base AS fromBase,to_base AS toBase,from_sheet AS fromSheet,to_sheet AS toSheet,COUNT(DISTINCT client_id) AS total FROM base_movements WHERE at>=? AND at<? GROUP BY from_base,to_base,from_sheet,to_sheet ORDER BY total DESC,from_sheet,to_sheet').bind(start,end).all()).results;
 const tracked=await d.prepare("SELECT json_extract(data,'$.at') AS at FROM settings WHERE id='base-movements-start'").first();
 return {day,since:tracked?.at||'',partial:!!tracked?.at&&tracked.at>start,rows};
}
