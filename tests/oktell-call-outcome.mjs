import assert from 'node:assert/strict';
import {manualOktellOutcome} from '../lib/oktell-call-outcome.ts';
// A 200 on the browser leg followed by an external 500 must never become a conversation.
for(const state of ['connected','ended','cancelled']){
 const result=manualOktellOutcome(state);
 assert.notEqual(result.status,'connected');assert.notEqual(result.status,'completed');
 assert.equal(result.answered,null);assert.match(result.detail,/ответ абонента не подтверждён/);
}
for(const state of ['failed','busy','no_answer'])assert.equal(manualOktellOutcome(state).status,state);
console.log('PASS: PBX answer is not callee answer; failures preserved. No calls.');
