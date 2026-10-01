import assert from 'node:assert/strict';
import {hasActiveOrder} from '../lib/crm.ts';
for(const status of ['draft','confirm','rework','check','extra','packing','phone','shipping','pickup'])assert(hasActiveOrder([{clientId:'c',status}],'c'));
for(const status of ['redeemed','returned','refused'])assert(!hasActiveOrder([{clientId:'c',status}],'c'));
assert(!hasActiveOrder([{clientId:'other',status:'draft'}],'c'));
console.log('Repeat order active-status guard passed');
