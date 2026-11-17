import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const pm = require('picomatch');
for (const name of ['micromatch', 'tinyglobby', 'vite']) {
  assert.equal(createRequire(require.resolve(name))('picomatch'), pm, `${name} must use the patched matcher`);
}
for (const [file, pattern, options, expected] of [
  ['app/page.tsx', '**/*.{ts,tsx}', {}, true],
  ['app/page.js', '**/*.{ts,tsx}', {}, false],
  ['.next/server.js', '**/*.js', {}, false],
  ['.next/server.js', '**/*.js', { dot: true }, true],
  ['page.tsx', '+(page|layout).tsx', {}, true],
  ['aaa', '+(a)', {}, true],
  ['C:/repo/app/page.tsx', 'C:/**/*.tsx', { windows: true }, true],
]) assert.equal(pm.isMatch(file, pattern, options), expected, pattern);
assert.equal(typeof pm.scan('app/**/*.tsx').base, 'string');
assert(pm.parse('**/*.tsx').output);
// A child timeout makes the original exponential regex fail without hanging CI.
const child = spawnSync(process.execPath, ['-e', `
const assert = require('node:assert/strict');
const pm = require('picomatch');
for (const pattern of ['+(*)', '+(*a)', '*(a*)', '+(a+)', '+(?*a)']) {
  assert.equal(pm.isMatch('a'.repeat(100) + '!', pattern), false, pattern);
  assert.equal(pm.isMatch(pattern, pattern), true, 'risky patterns are literalized');
}
`], { encoding: 'utf8', timeout: 3000 });
assert.ifError(child.error);
assert.equal(child.status, 0, child.stderr);
console.log('Patched picomatch consumers, glob compatibility and ReDoS regression passed');
