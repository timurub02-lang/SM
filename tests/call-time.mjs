import assert from 'node:assert/strict';
import {callTimeClass} from '../lib/crm.ts';
const due='2026-09-30T10:00:00Z',now=Date.parse(due);
assert.equal(callTimeClass(due,now-1),'');
assert.equal(callTimeClass(due,now),'call-due');
assert.equal(callTimeClass(due,now+299999),'call-due');
assert.equal(callTimeClass(due,now+300000),'overdue-call');
assert.equal(callTimeClass('',now),'');
console.log('Call time colors passed');
