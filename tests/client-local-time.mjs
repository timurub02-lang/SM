import assert from 'node:assert/strict';
import {clientLocalTime,orderTimeAddress} from '../lib/client-local-time.ts';
const now=Date.parse('2026-11-12T20:40:00Z');
const c=city=>({city,address:''});
assert.equal(clientLocalTime(c('Россия, Челябинская область, Миасское'),now),'У клиента 01:40 · МСК +2');
assert.equal(clientLocalTime(c('Челябинская обл., Миасское'),now),'У клиента 01:40 · МСК +2');
assert.equal(clientLocalTime(c('Калининградская область'),now),'У клиента 22:40 · МСК -1');
assert.equal(clientLocalTime(c('Московская область'),now),'У клиента 23:40 · МСК');
assert.equal(clientLocalTime(c('Камчатский край'),now),'У клиента 08:40 · МСК +9');
assert.equal(clientLocalTime(c('Республика Саха (Якутия)'),now),'Местное время не определено');
assert.equal(clientLocalTime(c('Неизвестно'),now),'Местное время не определено');
assert.equal(clientLocalTime(c('ул. Московская'),now),'Местное время не определено');
assert.equal(clientLocalTime({...c('Калининградская область'),addressParts:{region:'Челябинская область'}},now),'У клиента 01:40 · МСК +2');
console.log('Client local time: regions, abbreviation, midnight, Moscow offsets, ambiguity and unknown addresses passed');

assert.equal(clientLocalTime(c('Калининградская область'),Date.parse('2026-11-12T21:40:00Z')),'У клиента 23:40 · МСК -1');

const destination={address:'Приморский край, г Владивосток',addressParts:{region:'Приморский край'}};
const oldClient=c('Санкт-Петербург');
assert.equal(clientLocalTime(orderTimeAddress(destination,oldClient),now),'У клиента 06:40 · МСК +7');
assert.equal(orderTimeAddress({address:''},oldClient),oldClient);
assert.equal(clientLocalTime(orderTimeAddress({address:'Неизвестный адрес'},oldClient),now),'Местное время не определено');
