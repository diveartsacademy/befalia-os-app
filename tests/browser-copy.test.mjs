// The Sea Diva dashboard runs a generated browser copy of _sd-business.js.
// This proves the copy sorts the fixture exactly like the original.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { build } from '../api/_sd-business.js';
import { feed } from './fixture-pack.mjs';
import { products } from './fixture-feed.mjs';

test('browser copy gives the same answer as the original', () => {
  const copy = execFileSync(process.execPath, [new URL('../scripts/browser-sd-business.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  const ctx = vm.createContext({});
  vm.runInContext('var window = globalThis;', ctx);
  vm.runInContext(readFileSync(new URL('../api/_sd-overview.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(copy, ctx);
  const now = new Date('2026-10-13T02:00:00Z');
  const a = JSON.parse(JSON.stringify(build(feed, products, now)));
  const b = JSON.parse(JSON.stringify(ctx.window.SDBusiness.build(JSON.parse(JSON.stringify(feed)), products, now)));
  assert.deepEqual(b, a);
});
