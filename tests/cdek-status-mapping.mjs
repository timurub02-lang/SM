import assert from 'node:assert/strict';
import {cdekStatuses,cdekMappingSchema} from '../lib/cdek-statuses.ts';
assert.equal(cdekStatuses.length,35);
assert.equal(new Set(cdekStatuses.map(s=>s.code)).size,35);
assert.deepEqual(cdekMappingSchema.parse({DELIVERED:'paid',CREATED:'',NOT_DELIVERED:'returned'}),{DELIVERED:'paid',CREATED:'',NOT_DELIVERED:'returned'});
assert.throws(()=>cdekMappingSchema.parse({DELIVERED:'unknown'}));
assert.throws(()=>cdekMappingSchema.parse({UNKNOWN:'sent'}));
assert.deepEqual(cdekMappingSchema.parse({}),{});
console.log('CDEK status mapping validation passed');
