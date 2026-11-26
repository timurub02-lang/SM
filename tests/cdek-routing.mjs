import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cycleSettingsForEdit,editableCycleSlots,previewRoutingDay,chooseRouting,mainRoutingProduct,routingWindow,routingSchema,routingReservationGuard} from '../lib/cdek-routing.ts';
const now=new Date('2026-10-05T08:00:00Z');
const accounts=[{slot:1,name:'СМ',configured:true},{slot:2,name:'ИП Киселева',configured:true},{slot:4,name:'ИП Аскеров',configured:true}];
const base={id:'r1',name:'Товар X',enabled:true,slot:1,from:'',to:'',departments:[],products:['X'],weekdays:[],period:'week',maxCount:null,maxAmount:null};
const config={enabled:true,revision:'1',rules:[base,{...base,id:'r2',name:'Товар Y',products:['Y'],slot:2}]};
const order={id:'o',manager:'m',items:[{name:'X',price:500,quantity:10},{name:'Y',price:1000,quantity:1}]};
assert.equal(mainRoutingProduct(order.items).name,'Y');
assert.equal(chooseRouting(config,accounts,order,'1',[],now).slot,2);
assert.equal(chooseRouting(config,accounts,{items:[{name:'X',price:1000,quantity:1},{name:'Y',price:1000,quantity:8}]},'1',[],now).slot,1);
assert.equal(chooseRouting(config,accounts,order,'5',[],now).slot,4);
assert.equal(chooseRouting({...config,enabled:false},accounts,order,'5',[],now).slot,4);
assert.equal(chooseRouting({...config,enabled:false},accounts,order,'1',[],now),null);
assert.throws(()=>chooseRouting(config,accounts.filter(a=>a.slot!==4),order,'5',[],now),/отдела А_/);
assert.deepEqual(routingWindow(base,now),{start:'2026-10-04T21:00:00.000Z',end:'2026-10-11T21:00:00.000Z'});
assert.deepEqual(routingWindow({...base,period:'month',from:'2026-10-05',to:'2026-10-10'},now),{start:'2026-10-04T21:00:00.000Z',end:'2026-10-10T21:00:00.000Z'});
const general={...base,products:[],maxCount:1,maxAmount:6000,from:'2026-10-05',to:'2026-10-05',weekdays:[1],departments:['1']};
const limited={...config,rules:[general]};
assert.equal(chooseRouting(limited,accounts,order,'1',[],now).slot,1);
for(const patch of [{weekdays:[2]},{departments:['2']},{to:'2026-10-04'},{from:'2026-10-06'},{maxAmount:5999}])assert.throws(()=>chooseRouting({...config,rules:[{...general,...patch}]},accounts,order,'1',[],now));
const usage=[{slot:1,state:'unknown',createdAt:now.toISOString(),amountCents:600000}];
assert.throws(()=>chooseRouting(limited,accounts,order,'1',usage,now));
assert.equal(chooseRouting(limited,accounts,order,'1',[{...usage[0],state:'invalid'}],now).slot,1);
assert.equal(chooseRouting({...config,rules:[general,{...general,id:'fallback',slot:2}]},accounts,order,'1',usage,now).slot,2);
assert.equal(routingSchema.safeParse({...config,rules:[{...base,from:'2026-02-30'}]}).success,false);
// The same reservation predicate used in production must reject the second sender atomically.
const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE orders(id TEXT PRIMARY KEY,data TEXT,version INTEGER)');
db.prepare('INSERT INTO employees VALUES(?,?)').run('m','{}');db.prepare('INSERT INTO orders VALUES(?,?,1)').run('old',JSON.stringify({items:[{name:'X',price:200,quantity:2}]}));
const route={raw:'',managerRaw:'{}',amountCents:600000,choice:{slot:1,start:'2020-01-01T00:00:00.000Z',end:'2099-01-01T00:00:00.000Z',maxCount:1,maxCents:600000}};
function reserve(id,r=route){const guard=routingReservationGuard(r,{...order,id});return db.prepare(`INSERT INTO settings SELECT ?,? WHERE ${guard.sql}`).run('cdek-shipment-'+id,JSON.stringify({slot:1,state:'sending',createdAt:new Date().toISOString(),routingAmountCents:600000}),...guard.values).changes;}
assert.equal(reserve('one'),1);assert.equal(reserve('two'),0);
db.prepare('UPDATE settings SET data=json_set(data,\'$.state\',\'invalid\')').run();assert.equal(reserve('two'),1);
assert.equal(reserve('three',{...route,raw:'stale'}),0);
db.exec('DELETE FROM settings');db.prepare('INSERT INTO settings VALUES(?,?)').run('cdek-shipment-old',JSON.stringify({slot:1,state:'ready',createdAt:new Date().toISOString()}));
assert.equal(reserve('four',{...route,choice:{...route.choice,maxCount:null,maxCents:639999}}),0);
assert.equal(reserve('five',{...route,choice:{...route.choice,maxCount:null,maxCents:640000}}),1);
assert.equal(reserve('stale-date',{...route,choice:{...route.choice,scheduleDate:'2001-01-01'}}),0);
db.close();console.log('CDEK routing: main product, equal prices, mandatory A_, dates, priority, quota fallback, invalid retries, legacy amounts and atomic reservation passed.');

// The selected Monday anchors the cycle even across New Year and Moscow midnight.
const cycleAccounts=[...accounts,{slot:3,name:'ИП Стручев',configured:true}];
const cycle=routingSchema.parse({...config,cycleStart:'2026-12-21',rules:[
 {...base,products:[],id:'kis',slot:2,weekdays:[1,3,5],cycleDays:[[1,3,5],[1,3,5]]},
 {...base,products:[],id:'str',slot:3,weekdays:[4],cycleDays:[[4],[]]},
 {...base,products:[],id:'sm',slot:1,weekdays:[2],cycleDays:[[2],[2,4]]}
]});
const select=(at,dept='1')=>chooseRouting(cycle,cycleAccounts,order,dept,[],new Date(at));
for(let offset=0;offset<28;offset++){
 const at=new Date(Date.parse('2026-12-20T21:00:00Z')+offset*86400000);
 const expected=[2,1,2,Math.floor(offset/7)%2===0?3:1,2,null,null][offset%7];
 if(expected===null)assert.throws(()=>select(at),/нет подходящего правила/);
 else assert.equal(select(at).slot,expected);
 assert.equal(select(at,'5').slot,4);
}
assert.equal(select('2026-12-17T09:00:00Z').slot,3);
assert.equal(select('2026-12-30T20:59:59Z').slot,2);
assert.equal(select('2026-12-30T21:00:00Z').slot,1);
for(const start of ['2026-12-22','2026-11-31',''])assert.equal(routingSchema.safeParse({...cycle,cycleStart:start}).success,false);
assert.equal(routingSchema.safeParse({...cycle,rules:[{...base,cycleDays:[[8],[]]}]}).success,false);
assert.equal(chooseRouting({...cycle,rules:[{...base,products:[]}]},accounts,order,'1',[],now).slot,1);

for(const [date,slots] of [['2026-12-24',[3]],['2026-12-31',[1]],['2027-01-07',[3]],['2026-12-26',[]]]){
 assert.deepEqual(previewRoutingDay(cycle,date),{slots,conditional:false});
}
const rules=[{...general,slot:3},{...base,slot:2,products:[]},{...base,slot:1,products:[]}];
assert.deepEqual(previewRoutingDay({...config,rules},'2026-10-05'),{slots:[3,2],conditional:true});
assert.deepEqual(previewRoutingDay({...config,rules},'2026-10-12'),{slots:[2],conditional:false});

const schedule=editableCycleSlots(cycle);
assert.deepEqual(schedule,[2,1,2,3,2,null,null,2,1,2,1,2,null,null]);
schedule[3]=2;
const simple={...cycle,cycleSlots:schedule};
for(const [date,slot] of [['2026-12-24',2],['2026-12-31',1]]){
 assert.deepEqual(previewRoutingDay(simple,date).slots,[slot]);
 assert.equal(chooseRouting(simple,cycleAccounts,order,'1',[],new Date(date)).slot,slot);
}
assert.throws(()=>chooseRouting(simple,cycleAccounts,order,'1',[],new Date('2026-12-26')),/не назначена/);
assert.equal(chooseRouting(simple,cycleAccounts,order,'5',[],new Date('2026-12-26')).slot,4);
assert.equal(routingSchema.safeParse({...simple,cycleSlots:[2,3]}).success,false);
assert.equal(routingSchema.safeParse({...simple,cycleSlots:schedule.map(()=>[1,2])}).success,false);

// Switching off a weekly rule, or all weekly routing, preserves the independent cycle.
const opened=cycleSettingsForEdit(cycle);
const weeklyOff={...opened,enabled:false,rules:opened.rules.map(r=>({...r,enabled:false}))};
assert.equal(chooseRouting(weeklyOff,cycleAccounts,order,'1',[],new Date('2026-12-24')).slot,3);
assert.deepEqual(previewRoutingDay(weeklyOff,'2026-12-24').slots,[3]);
assert.equal(chooseRouting({...weeklyOff,cycleStart:undefined},cycleAccounts,order,'1',[],now),null);
assert.equal(chooseRouting({...opened,cycleEnabled:false},cycleAccounts,order,'1',[],new Date('2026-12-24')),null);

const added={slot:12,name:'Второй аккаунт',type:'departmentA',configured:true};
const more=[...accounts,added];
const weekly={...cycle,departmentAWeek:[4,12,4,12,4,4,12]};
for(const [day,slot] of [['2026-11-23',4],['2026-11-24',12],['2026-11-29',12],['2026-12-01',12]]){
 assert.equal(chooseRouting(weekly,more,order,'5',[],new Date(day+'T12:00:00Z')).slot,slot);
}
assert.equal(chooseRouting(weekly,more,order,'5',[],new Date('2026-11-23T21:01:00Z')).slot,12);
assert.equal(chooseRouting(config,more,order,'5',[],now).slot,4);
assert.throws(()=>chooseRouting({...config,rules:[{...general,slot:12}]},more,order,'1',[],now));
assert.throws(()=>chooseRouting({...weekly,departmentAWeek:Array(7).fill(2)},more,order,'5',[],now));
