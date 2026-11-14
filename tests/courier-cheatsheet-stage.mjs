import assert from 'node:assert/strict';
import {canDownloadCourierCheatsheet} from '../lib/internal-waybill.ts';
for(const status of ['draft','confirm','extra','check','rework','cancelled'])assert.equal(canDownloadCourierCheatsheet({delivery:'moscow_courier',status}),false,status);
for(const status of ['packing','phone','shipping','pickup','redeemed','returned']){
 assert.equal(canDownloadCourierCheatsheet({delivery:'moscow_courier',status}),true,status);
 for(const delivery of ['russian_post','cdek_courier',undefined])assert.equal(canDownloadCourierCheatsheet({delivery,status}),false);
}
assert.equal(canDownloadCourierCheatsheet({delivery:'moscow_courier',status:'rework',courierRecall:{returnedAt:'2026-11-14',completedAt:'2026-11-14'}}),true);
console.log('courier cheatsheet stages: OK');
