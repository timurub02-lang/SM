// Build a separate, reviewed Oktell installation artifact. This never connects to a server.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import registry from '../data/phone-timezones/ranges.json' with {type:'json'};
import {pilotSchema} from '../lib/oktell-pilot.ts';
export function exportCallTimeSql(input){
 const p=pilotSchema.parse(input);if(!p.native)throw Error('Native task binding required');
 const asOf=new Date(registry.asOf+'T00:00:00Z'),until=new Date(asOf.getTime()+90*86400000);
 function offset(zone,date){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,timeZoneName:'longOffset'}).formatToParts(date).map(p=>[p.type,p.value]));const m=/^GMT\+(\d{2}):(\d{2})$/.exec(parts.timeZoneName);if(!m)throw Error('Unsupported zone');return Number(m[1])*60+Number(m[2]);}
 const offsets=registry.zones.map(z=>{const n=offset(z,asOf);for(let d=1;d<=90;d++)if(offset(z,new Date(+asOf+d*86400000))!==n)throw Error('Timezone transition requires shorter registry validity');return n;});
 const statements=['SET XACT_ABORT ON; BEGIN TRANSACTION;',"DECLARE @lock int; EXEC @lock=sys.sp_getapplock @Resource='CRM_CallTimeRegistry',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000; IF @lock<0 THROW 50000,'Registry update is busy',1;",'DELETE FROM dbo.CRM_PhoneTimeRanges;'];
 const tuples=registry.ranges.map(([lo,hi,ids])=>{const values=ids.map(id=>offsets[id]);return `(${lo},${hi},${values.length?Math.min(...values):'NULL'},${values.length?Math.max(...values):'NULL'})`;});
 for(let i=0;i<tuples.length;i+=1000)statements.push('INSERT INTO dbo.CRM_PhoneTimeRanges(StartNumber,EndNumber,MinOffset,MaxOffset) VALUES '+tuples.slice(i,i+1000).join(',')+';');
 const hash=createHash('sha256').update(JSON.stringify(registry)).digest('hex');
 statements.push('DELETE FROM dbo.CRM_PhoneTimeRegistry;',`INSERT INTO dbo.CRM_PhoneTimeRegistry VALUES(1,'${asOf.toISOString()}','${until.toISOString()}','${hash}');`);
 const task=p.native.taskId,minute=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
 statements.push(`DELETE FROM dbo.CRM_CallTimeSchedule WHERE TaskId='${task}';`,`DELETE FROM dbo.CRM_CallTimePolicies WHERE TaskId='${task}';`,`INSERT INTO dbo.CRM_CallTimePolicies VALUES('${task}',${minute(p.clientWindow.from)},${minute(p.clientWindow.to)});`);
 statements.push('INSERT INTO dbo.CRM_CallTimeSchedule VALUES '+p.schedule.map(s=>`('${task}',${s.day},${minute(s.from)},${minute(s.to)})`).join(',')+';','COMMIT;');
 return statements.join('\n')+'\n';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(!process.argv[2]||!process.argv[3])throw Error('Usage: export-call-time-sql.mjs <CRM project JSON> <output.sql>');fs.writeFileSync(process.argv[3],exportCallTimeSql(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))));}
