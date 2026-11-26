import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {compileCheckedU64ScalarV1 as compile} from '../src/checked-u64-scalar-v1.mjs';

const bytes = readFileSync(new URL('../contracts/atto-xo-checked-u64-debit-v1/cases.tsv', import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'), '3a79dc1db8ee896fc2b39a4df136c102ebfa341f282b8d16785fb035b663ca58');
const rows = bytes.toString('utf8').trimEnd().split('\n');
assert.equal(rows.length, 12);
const run = async source => (await import('data:text/javascript,' + encodeURIComponent(compile(source)))).main();
for (const row of rows) {
  const [id, expected, , , , , , , source] = row.split('|');
  test('compiled unsigned guest: ' + id, async () => {
    if (expected === 'overflow') {
      await assert.rejects(run(source), e => e instanceof RangeError && e.code === 'integer_overflow');
    } else assert.equal(await run(source), BigInt(expected));
  });
}
const guest = body => 'pub fnc main(): u64 { return ' + body + '; }';
test('operator precedence, alias equivalence and forward calls', async () => {
  assert.equal(await run(guest('4+5*6')), 34n);
  assert.equal(await run(guest('10-3-2')), 5n);
  assert.equal(await run(guest('(4+5)*6')), 54n);
  assert.equal(await run(guest('later(41)') + ' fnc later(uint n): u64 {return n+1;}'),42n);
});
test('unsupported or invalid sources are rejected before emission', () => {
  for (const src of [guest('18446744073709551616'), guest('-1'), guest('1/2'), guest('x'), guest('main()'),
    guest('f(1)') + ' fnc f():u64{return 1;}', guest('1') + ' fnc f(int n):u64{return 1;}',
    guest('1') + ' fnc f(u64 n,u64 n):u64{return n;}', guest('1') + guest('2'),
    guest('1') + ' fnc f():u64{return g();} fnc g():u64{return f();}',
    guest('1' + '+1'.repeat(100)), guest('('.repeat(40)+'1'+')'.repeat(40)),
    guest('1') + ' import evil;', guest('1') + '\u202e', guest('1') + ' // comment',
    guest('1') + ' '.repeat(17000)]) {
    assert.throws(() => compile(src), /E_U64_PROFILE/);
  }
});
test('acyclic exponential call graph is refused by expanded work budget', () => {
  let source = guest('f15()') + ' fnc f0():u64{return 1;}';
  for (let i=1;i<=15;i++) source += ` fnc f${i}():u64{return f${i-1}()+f${i-1}();}`;
  assert.throws(() => compile(source), /expanded work budget/);
});
