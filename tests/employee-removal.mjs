import assert from 'node:assert/strict';
import {releasedClient} from '../lib/employee-removal.ts';
const c={id:'c',owner:'a',source:'base.xlsx · Т2',sheet:'К',returnSheet:'Т2',assignedUntil:'2099-01-01',trialUntil:'2099-01-01',orderRequest:{manager:'a'}};
const o=status=>({clientId:'c',status});
assert.equal(releasedClient(c,[o('redeemed'),o('shipping')]).sheet,'К');
assert.equal(releasedClient(c,[o('redeemed'),o('returned')]).sheet,'П');
assert.equal(releasedClient(c,[o('redeemed')]).sheet,'П'); // Even missing redemption dates: treat the 5 weeks as elapsed.
assert.equal(releasedClient(c,[o('refused')]).sheet,'Т2');
assert.equal(releasedClient({...c,returnSheet:undefined},[o('returned')]).sheet,'Т2');
assert.equal(releasedClient({...c,returnSheet:undefined},[]).sheet,'Т1');
const released=releasedClient(c,[o('shipping')]);assert.equal(released.owner,'');assert.equal(released.assignedUntil,'');assert.equal(released.trialUntil,undefined);assert.equal(released.orderRequest,undefined);
console.log('Forced release routing passed');
