import assert from 'node:assert/strict';
import {notificationSections,notificationPopupTab} from '../lib/notification-sections.ts';
const incoming={id:'task:incoming:1',kind:'incoming'},order={id:'task:order:1',kind:'task'},event={id:'event:1'};
const groups=notificationSections([incoming,order],[event]);
assert.deepEqual(groups.incoming,[incoming]);assert.deepEqual(groups.tasks,[order]);assert.deepEqual(groups.events,[event]);
assert.equal(notificationPopupTab([incoming],[incoming,order]),'incoming');
assert.equal(notificationPopupTab([order,incoming],[incoming,order]),'tasks');
assert.equal(notificationPopupTab([event],[incoming,order]),'events');
assert.equal(notificationSections([],[]).incoming.length,0);
console.log('Notification sections: incoming separated, remaining tasks and events preserved, popup destinations passed');

const old={id:'old',kind:'incoming',resolved:true};assert.deepEqual(notificationSections([], [old]).incoming,[old]);

const paid={id:'paid',kind:'order-paid'};const releases=Array.from({length:20},(_,i)=>({id:'release:'+i,kind:'client-released'}));
assert.deepEqual(notificationSections([],[...releases,paid]).paid,[paid],'buyouts remain reachable outside the general 20-event page');

const now=Date.parse('2026-11-16T10:00:00Z'),due='2026-11-18T09:46:00Z';
const call={kind:'call',id:'task:order:call:'+due,orderId:'order',due};
const acknowledged={kind:'call',id:'call:order:'+due,due,readAt:'2026-11-16T11:00:00Z',acknowledgedAt:'2026-11-16T11:00:00Z'};
assert.deepEqual(notificationSections([call],[],now).tasks,[]);
assert.deepEqual(notificationSections([call],[],now).planned,[call]);
assert.deepEqual(notificationSections([call],[acknowledged],now,true).planned,[],'Head acknowledgement removes only the planned notice');
assert.deepEqual(notificationSections([call],[acknowledged],now,false).planned,[call],'Operator keeps the scheduled call');
assert.deepEqual(notificationSections([call],[acknowledged],Date.parse(due),true).tasks,[call],'At the due time acknowledgement cannot hide the task');
const moved={...call,due:'2026-11-19T09:46:00Z'};
assert.deepEqual(notificationSections([moved],[acknowledged],now,true).planned,[moved],'A new date requires a new acknowledgement');
assert.deepEqual(notificationSections([call],[{...acknowledged,acknowledgedAt:undefined}],now,true).planned,[call],'Opening a reminder is not acknowledgement');

const cash={id:'cash:1',kind:'cash-change'};
assert.deepEqual(notificationSections([order],[cash],now,false,true).tasks,[order]);
assert.deepEqual(notificationSections([order],[cash],now,false,true).acknowledge,[cash]);
assert.deepEqual(notificationSections([],[{...cash,acknowledgedAt:due}],now,false,true).acknowledge,[]);
assert.deepEqual(notificationSections([],[cash],now).tasks,[cash]);

{
const {audibleNotifications}=await import('../lib/notification-sections.ts');
const due='2026-11-21T11:30:00Z';
const call={kind:'call',id:'callback',due};
const signalAt=time=>{
 const groups=notificationSections([call,{id:'task:incoming:1',incomingId:'1'}],[{kind:'incoming',id:'notice',incomingId:'1'}],time);
 return audibleNotifications(groups.tasks,groups.incoming).map(r=>r.id);
};
assert.deepEqual(signalAt(Date.parse(due)-1),['incoming:1']);
assert.deepEqual(signalAt(Date.parse(due)),['callback:'+due,'incoming:1']);
}
