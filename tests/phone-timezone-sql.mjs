import fs from 'node:fs';
import {exportCallTimeSql} from '../scripts/export-call-time-sql.mjs';
import phoneTime from '../lib/phone-timezone.cjs';
import registry from '../data/phone-timezones/ranges.json' with {type:'json'};
const uuid='10000000-0000-4000-8000-000000000001';
const p={name:'Synthetic',state:'draft',contacts:[1,2,3].map(n=>({name:'Fixture',phone:'+7999000000'+n})),operatorIds:['E-fixture'],native:{taskId:uuid,projectId:uuid,listId:uuid,verifiedAt:'2026-10-30T00:00:00Z',active:false,operatorUserIds:[uuid],line:'Synthetic'},mode:'predictive',ringSeconds:50,maxAttempts:3,order:'attempt_count_ascending',timezone:'Europe/Moscow',schedule:Array.from({length:7},(_,i)=>({day:i+1,from:'06:00',to:'21:00'})),clientWindow:{from:'09:00',to:'20:00'},retries:['busy','no_answer','declined','lost','answering_machine','error'].map(result=>({result,kind:'after',minutes:30,attempts:3})),results:['Fixture'],telephony:'existing_oktell_only'};
const schema=fs.readFileSync(new URL('../scripts/oktell-bridge/call-time-schema.sql',import.meta.url),'utf8');
const queries=["CREATE DATABASE T1TimeFixture;\nGO\nUSE T1TimeFixture;\nGO",'CREATE TABLE dbo.CRM_DeliveryContacts(Id int,TaskId uniqueidentifier,Phone varchar(11),BatchId uniqueidentifier); CREATE TABLE dbo.CRM_DeliveryReceipts(BatchId uniqueidentifier,TaskId uniqueidentifier,Cancelled bit);\nGO',schema,exportCallTimeSql(p),'GO'];
const numbers=registry.zones.map((z,i)=>String(registry.ranges.find(r=>r[2].length===1&&r[2][0]===i)?.[0]||'' )).filter(Boolean);
numbers.push(String(registry.ranges.find(r=>r[2].length>1)[0]),String(registry.ranges.find(r=>!r[2].length)[0]),'70000000000');
let cases=0;
for(const number of numbers)for(const time of ['2026-10-30T00:00:00Z','2026-10-30T05:59:59Z','2026-10-30T06:00:00Z','2026-10-30T07:59:59Z','2026-10-30T08:00:00Z','2026-10-30T16:59:59Z','2026-10-30T17:00:00Z','2026-10-30T22:00:00Z','2027-02-01T10:00:00Z']){
 const expected=phoneTime.callTimeDecision(number,p,new Date(time));
 queries.push(`IF NOT EXISTS(SELECT 1 FROM dbo.CRM_CallTimeDecision('${uuid}','${number}','${time}') WHERE Allowed=${expected.allowed?1:0} AND Reason='${expected.reason}') THROW 50000,'Case ${++cases}: JS/SQL decision mismatch',1;`);
}
queries.push(`DECLARE @result TABLE(Allowed bit,Reason varchar(40)); INSERT @result EXEC dbo.w_crm_t1_time_gate @task='${uuid}',@id=1,@phone='70000000000'; IF NOT EXISTS(SELECT 1 FROM @result WHERE Allowed=0 AND Reason='contact_mismatch') THROW 50000,'Unbound number must not pass dial gate',1;`,`PRINT 'PASS: ${cases} real SQL Server boundary decisions agree with JS; no calls';`);
fs.writeFileSync(process.argv[2],queries.join('\n'));
