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
