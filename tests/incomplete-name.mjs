import assert from 'node:assert/strict';
import {needsNameExplanation,nameExplanationSchema} from '../lib/incomplete-name.ts';
for(const status of ['draft','rework'])for(const to of ['confirm','extra','packing']){
 assert.equal(needsNameExplanation(status,to,'Дмитрий Александрович'),true);
 assert.equal(needsNameExplanation(status,to,'  Иванов  Дмитрий\nАлександрович '),false);
}
assert.equal(needsNameExplanation('confirm','check','Дмитрий'),false);
assert.equal(needsNameExplanation('draft','refused','Дмитрий'),false);
for(const text of [undefined,'','   ','x'.repeat(1001)])assert.equal(nameExplanationSchema.safeParse(text).success,false);
assert.equal(nameExplanationSchema.parse(' клиент так пожелал '),'клиент так пожелал');
console.log('Incomplete name handoff validation passed');
