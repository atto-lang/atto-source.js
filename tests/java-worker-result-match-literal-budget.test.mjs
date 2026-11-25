import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

// An attacker-controlled match-arm literal must be compared as short decimal
// text before materializing BigInt. Preserve signed-i64 semantics and Result
// provenance; these fixtures use the real trusted source-to-ESM guest.
const subject=literal=>
  'pub fnc main(): int { return match int.parse("42") over '+
  'on Ok(value) -> '+literal+', on Err() -> 0 end; }';

async function execute(literal){
  const artifact=transpile_to_worker(subject(literal));
  assert.equal(artifact.guest_abi,'atto.js.browser.result-int-parse.v1');
  const esm=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(artifact.module_source));
  const guest=await esm.create_tenant({tenant:'result-literal',generation:1});
  return (await guest.on_message()).value;
}

test('bounded Result match literals execute with exact signed-i64 identity',async()=>{
  for(const [literal,want] of [
    ['42','42'],
    ['0'.repeat(6000)+'42','42'],
    ['-0'.padEnd(6002,'0')+'42','-42'],
    ['9223372036854775807','9223372036854775807'],
    ['-9223372036854775808','-9223372036854775808']
  ]) assert.equal(await execute(literal),want,literal.length+'-digit literal');
});

test('oversized Result match literals reject before emitting a guest',()=>{
  for(const literal of [
    '9223372036854775808',
    '-9223372036854775809',
    '9'.repeat(60000),
    '-9'.repeat(60000),
    '0'.repeat(6000)+'9223372036854775808'
  ]) assert.throws(
    ()=>transpile_to_worker(subject(literal)),
    e=>e instanceof TranspileError && e.code==='E_INT_OVERFLOW'
  );
});

test('Result match literal bounds do not mask typed tag or parse errors',async()=>{
  assert.equal(await execute('0'.repeat(4000)+'7'),'7');
  const bad='pub fnc main(): int { return match int.parse("invalid") over on Ok(value) -> 42, on Err() -> 9 end; }';
  const artifact=transpile_to_worker(bad);
  const esm=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(artifact.module_source));
  const guest=await esm.create_tenant({tenant:'negative-result',generation:1});
  assert.equal((await guest.on_message()).value,'9');
});
