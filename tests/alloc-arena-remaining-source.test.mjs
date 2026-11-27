import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileProgramV2} from '../src/program-v2.mjs';

const source = readFileSync(new URL('../stdlib/alloc/arena.atto', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('../contracts/alloc-arena-remaining-v1/guest.atto', import.meta.url));
const MIN = -(1n << 63n), MAX = (1n << 63n) - 1n;
const points = [MIN, MIN+1n, -1024n, -2n, -1n, 0n, 1n, 2n, 16n, 64n, 1024n, MAX-1n, MAX];
const oracle = (used, cap) => used < 0n || cap < 0n || used >= cap ? 0n : cap-used;
const probe = '\npub fnc remaining_probe(int used, int capacity): int { return arena.remaining(used, capacity); }\n';

test('canonical selector guest is pinned, not yet selector execution', () => {
  assert.equal(createHash('sha1').update('blob '+fixture.length+'\0').update(fixture).digest('hex'),
    'c64314a4f5cb31ac26db5845db3e4ae2d4fb5576');
});

test('compile actual Atto source module and execute signed i64 boundary matrix', async () => {
  const esm = compileProgramV2(source + probe);
  const guest = await import('data:text/javascript,'+encodeURIComponent(esm));
  let count=0;
  for (const used of points) for (const cap of points) {
    assert.equal(guest.remaining_probe(used,cap),oracle(used,cap),String(used)+'/'+String(cap));
    count++;
  }
  assert.equal(count,169);
});
