import assert from 'node:assert/strict';
import {normalizeOrderSearch as norm} from '../lib/order-search.ts';
assert.ok(norm('Любинецкая  Виктория Петровна').includes(norm('Любинецкая Виктория')));
assert.ok(norm('Любинецкая\u00a0 Виктория').includes(norm('  ЛЮБИНЕЦКАЯ\tВиктория  ')));
assert.ok(norm('Любинецкая Виктория SM-SK-51653250240').includes(norm('51653250240')));
assert.equal(norm('Любин Олег Викторович').includes(norm('Любинецкая Виктория')),false);
console.log('Order search tolerates repeated whitespace without false name matches');
