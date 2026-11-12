import assert from 'node:assert/strict';
import {baseSettingsSchema,initialBaseSettings,normalizeBaseSheet} from '../lib/base-policy.ts';
import {clientAssignment,applyRetention} from '../lib/crm.ts';
const config=initialBaseSettings();
assert.equal(baseSettingsSchema.safeParse(config).success,true);
config.J.sheets.push({name:'Ж1',projectId:'12',cycleDays:9,sendTime:'20:30'});config.J.importSheet='Ж1';
assert.equal(baseSettingsSchema.safeParse(config).success,true);
config.J.sheets[0].projectId='12';assert.equal(baseSettingsSchema.safeParse(config).success,false);config.J.sheets[0].projectId='';
config.J.importSheet='К';assert.equal(baseSettingsSchema.safeParse(config).success,false);
assert.equal(normalizeBaseSheet('ТК'),'П');assert.equal(normalizeBaseSheet('Т2'),'Т2');
const at='2026-10-05T09:00:00.000Z',client={id:'c',sheet:'Т2',owner:'',assignedUntil:'',source:'',version:1};
const assigned={...client,...clientAssignment(client,'op',at)};
assert.equal(assigned.trialReturnSheet,'Т2');assert.equal(assigned.sheet,'К');
const released=applyRetention(assigned,[],Date.parse(at)+86400000);
assert.equal(released.sheet,'Т2');assert.equal(released.owner,'');assert.ok(released.distributedAt);
const active={clientId:'c',manager:'op',createdAt:at,status:'rework'};
assert.equal(applyRetention(assigned,[active],Date.parse(at)+86400000).owner,'op');
console.log('Base settings, blocked sheets, independent import sheets and manual assignment checks passed');
const {workDate,distributionEligible,normalizedPhone,repeatSales}=await import('../lib/base-distribution.ts');
assert.equal(workDate('2026-10-02',1),'2026-10-05');
assert.equal(workDate('2026-10-02',2),'2026-10-06');
assert.equal(distributionEligible({releasedAt:'2026-10-02T12:00:00Z'},'2026-10-05'),false);
assert.equal(normalizedPhone('8 (999) 123-45-67'),'79991234567');assert.equal(normalizedPhone('bad'),'');
const sales=repeatSales([{clientId:'a',manager:'o',status:'redeemed',redeemedAt:'2026-06-07T10:00:00Z'},{clientId:'a',manager:'o',status:'redeemed',redeemedAt:'2026-06-24T10:00:00Z'},{clientId:'a',manager:'o',status:'redeemed',redeemedAt:'2026-05-24T10:00:00Z'}],'2026-06-06','2026-07-06');
assert.deepEqual(sales.o,{clients:1,repeats:1,repeatClients:1,percent:100,coverage:100});
const {retentionDays,previousThreeMonths}=await import('../lib/base-distribution.ts');
assert.deepEqual(previousThreeMonths(new Date('2026-10-03T12:00:00Z')),{from:'2026-07-01',to:'2026-09-30'});
assert.equal(retentionDays({mode:'statistics',days:35,defaultWeeks:5,bands:[{maxPercent:5,weeks:0}]},5.04),0);
assert.equal(retentionDays({mode:'statistics',days:35,defaultWeeks:5,bands:[{maxPercent:5,weeks:0}]},5.06),35);
const owned={...client,owner:'op',sheet:'К',assignmentStartedAt:'2026-01-01T00:00:00Z'};
const paid={clientId:'c',manager:'op',createdAt:'2026-01-02T00:00:00Z',status:'redeemed',redeemedAt:'2026-01-10T00:00:00Z'};
const pv={clientId:'c',manager:'op',createdAt:'2026-01-11T00:00:00Z',status:'returned',pv:true,returnedAt:'2026-01-12T00:00:00Z'};
assert.equal(applyRetention(owned,[paid,pv],Date.parse('2026-01-13T00:00:00Z')).sheet,'ЧС');
assert.equal(applyRetention(owned,[{...paid,redeemedAt:'2026-01-14T00:00:00Z'},pv],Date.parse('2026-01-15T00:00:00Z')).sheet,'К');
assert.equal(applyRetention(owned,[{...paid,pv:true},{...pv,pv:false}],Date.parse('2026-01-13T00:00:00Z')).sheet,'К');
// Two overlapping orders: either paid order wins, independent of which result arrives last.
const concurrentPV={...pv,createdAt:'2026-01-05T00:00:00Z'};
for(const status of ['returned','refused','shipping']){
 const other={...concurrentPV,status,pvMarkedAt:'2026-01-11T00:00:00Z',cancelledAt:'2026-01-12T00:00:00Z'};
 assert.equal(applyRetention(owned,[paid,other],Date.parse('2026-01-13T00:00:00Z')).sheet,'К');
 assert.equal(applyRetention(owned,[{...paid,pv:true},other],Date.parse('2026-01-13T00:00:00Z')).sheet,'К');
}
const inTransit={...paid,status:'shipping',redeemedAt:undefined};
assert.equal(applyRetention(owned,[inTransit,concurrentPV],Date.parse('2026-01-13T00:00:00Z')).sheet,'ЧС');
assert.equal(applyRetention(owned,[{...paid,redeemedAt:'2026-01-14T00:00:00Z'},concurrentPV],Date.parse('2026-01-15T00:00:00Z')).sheet,'К');
assert.equal(applyRetention(owned,[{...inTransit,status:'returned'},concurrentPV],Date.parse('2026-01-15T00:00:00Z')).sheet,'ЧС');
const expiredPV=applyRetention(owned,[paid,concurrentPV],Date.parse('2026-03-01T00:00:00Z'));
assert.equal(expiredPV.owner,'');assert.equal(expiredPV.sheet,'П');
assert.equal(applyRetention(owned,[paid],Date.parse('2026-01-10T00:00:01Z'),0).owner,'');
assert.equal(applyRetention(owned,[paid,{...pv,status:'rework'}],Date.parse('2026-01-10T00:00:01Z'),0).owner,'op');

// Release destination follows a clear name, only after all retention protections expire.
const releaseNow=Date.parse('2026-11-10T12:00:00Z');
const cross={...client,name:'Иванов Иван Иванович',baseType:'J',owner:'op',sheet:'К',assignmentStartedAt:'2026-01-01T00:00:00Z'};
const settled={clientId:'c',manager:'op',createdAt:'2026-01-01T00:00:00Z',status:'redeemed',redeemedAt:'2026-01-02T00:00:00Z'};
assert.equal(applyRetention(cross,[settled],releaseNow,14,true).baseType,'M');
assert.equal(applyRetention(cross,[settled],releaseNow,14,true).sheet,'П');
const woman={...cross,name:'Иванова Анна Ивановна',baseType:'M'};
assert.equal(applyRetention(woman,[settled],releaseNow,14,true).baseType,'J');
assert.equal(applyRetention(woman,[settled],releaseNow,14,true).sheet,'П');
for(const held of [applyRetention(cross,[settled],releaseNow,14,true,true),applyRetention(cross,[{...settled,status:'shipping'}],releaseNow,14,true),applyRetention(cross,[{...settled,redeemedAt:'2026-11-09T00:00:00Z'}],releaseNow,14,true)]){
 assert.equal(held.owner,'op');assert.equal(held.baseType,'J');
}
const ambiguous=applyRetention({...cross,name:'Иванов И. И.'},[settled],releaseNow,14,true);
assert.equal(ambiguous.baseType,'J');assert.equal(ambiguous.releaseBaseReview,true);
const free={...cross,owner:''};assert.deepEqual(applyRetention(free,[settled],releaseNow,14,true),free);
const blocked=applyRetention(cross,[{...settled,pv:true,status:'returned',returnedAt:'2026-11-01T00:00:00Z'}],releaseNow,14,true);
assert.equal(blocked.sheet,'ЧС');assert.equal(blocked.baseType,'J');
console.log('Release base routing and active/unpaid/ambiguous/blacklist protections passed');

assert.equal(applyRetention({...assigned,name:'Иванова Анна Ивановна',baseType:'M'},[],releaseNow).sheet,'ж1');
assert.equal(applyRetention({...assigned,name:'Иванова Анна Ивановна',baseType:'M',legacyOrderHistory:[{status:'paid'}]},[],releaseNow).sheet,'П');

// A one-off client extension survives fixed operator policies without moving purchase dates.
const expiry=Date.parse(settled.redeemedAt)+14*86400000;
const extended={...woman,retentionExtensionUntil:new Date(expiry+86400000).toISOString()};
assert.equal(applyRetention(extended,[settled],expiry+1,14,true).owner,extended.owner);
assert.equal(applyRetention(extended,[settled],expiry+1,14,true).assignedUntil,extended.retentionExtensionUntil);
assert.equal(applyRetention(extended,[settled],expiry+86400000,14,true).owner,'');
assert.equal(applyRetention(extended,[settled],expiry+86400000,14,true).retentionExtensionUntil,undefined);
assert.equal(clientAssignment(extended,'different',new Date(expiry).toISOString()).retentionExtensionUntil,undefined);
assert.equal(clientAssignment(extended,'',new Date(expiry).toISOString()).retentionExtensionUntil,undefined);
