import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

// Backend execution evidence for the *trusted, int-only* Atto JS subset.
// This does not attest to general Boolean, native AOT, or TenantVM support.
const guest = async expression => {
  const source = 'pub fnc main(): int { return ' + expression + '; }';
  const output = transpile_to_worker(source);
  assert.equal(output.trusted,true);
  const module = await import('data:text/javascript;charset=utf-8,' +
    encodeURIComponent(output.module_source));
  return (await (await module.create_tenant({tenant:'test',generation:1}))
    .on_message()).value;
};

test('BW-003 integer XOR executes checked-i64 guest output',async()=>{
  assert.equal(await guest('12 ^ 10'),'6');
  assert.equal(await guest('12 ^ 10 ^ 3'),'5');
  assert.equal(await guest('12 ^ (10 ^ 3)'),'5');
});

test('XOR has lower precedence than addition and multiplication',async()=>{
  assert.equal(await guest('1 + 2 ^ 3'),'0');
  assert.equal(await guest('1 ^ 2 + 3'),'4');
  assert.equal(await guest('1 * 2 ^ 3 + 1'),'6');
  assert.equal(await guest('2 ^ 3 * 4'),'14');
});

test('XOR preserves signed i64 two-complement patterns',async()=>{
  assert.equal(await guest('-1 ^ 0'),'-1');
  assert.equal(await guest('-1 ^ 9223372036854775807'),'-9223372036854775808');
  assert.equal(await guest('-9223372036854775808 ^ -1'),'9223372036854775807');
});

test('Boolean XOR remains a separate unsupported backend feature, not a removed operator',()=>{
  for(const expression of ['true ^^ false','12 ^^ 10','1 + (2 ^^ 3)']){
    assert.throws(
      ()=>transpile_to_worker('pub fnc main(): int { return '+expression+'; }'),
      error=>error instanceof TranspileError && error.code==='E_UNSUPPORTED_BOOL_XOR',
      expression
    );
  }
});

test('comments do not trigger Boolean XOR admission; no source escape',async()=>{
  const src='// ^^ in a comment is inert\n' +
    'pub fnc main(): int { /* ^ and ^^ */ return 12 ^ 10; }';
  const compiled=transpile_to_worker(src);
  assert.equal(compiled.guest_abi,'atto.js.browser.subset.v1');
  assert.equal(await guest('40 + 2'),'42');
  assert.doesNotMatch(compiled.module_source,/\bimport\s*\(/);
});

test('not-yet-lowered syntax stays fail-closed',()=>{
  for(const expression of ['12 % 10','^ 42','12 & 10','~12']){
    assert.throws(
      ()=>transpile_to_worker('pub fnc main(): int { return '+expression+'; }'),
      error=>error instanceof TranspileError,
      expression
    );
  }
});
