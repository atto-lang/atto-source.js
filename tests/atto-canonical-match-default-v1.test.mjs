import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';
import {validateProgramIRV2} from '../src/program-ir-v2.mjs';

// Executed ESM guest checks for the *program-v2 scalar subset* only.
// No Wasm/Forge/.NET, compiled Native Image, actor, or aggregate lowering claim.
const source = arms => 'pub fnc main():int { return match<int> 99 over '+arms+' end; }';
const run = async src => {
  const ir=compileToProgramIRV2(src);
  assert.deepEqual(validateProgramIRV2(JSON.parse(JSON.stringify(ir))),ir);
  const js=compileProgramV2(src);
  const guest=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));
  return guest.main();
};
test('canonical typed scalar default compiles to actual ESM guest exit 42',async()=>{
  assert.equal(await run(source('on 1 -> {11;} on 2 -> {22;} default -> {42;}')),42n);
  assert.equal(await run(source('default -> {42;}')),42n);
  assert.equal(await run('pub fnc main():int { return match<int> 2 over on 1 -> {0;} on 2 -> {42;} default -> {99;} end; }'),42n);
});
test('legacy on default and on underscore lower to the same checked fallback',async()=>{
  for (const alternative of ['on default -> {42;}','on _ -> {42;}','else -> {42;}']) {
    assert.equal(await run(source('on 1 -> {11;} '+alternative)),42n,alternative);
  }
});
test('duplicate/nonterminal/guarded default and typed missing over reject before IR generation',()=>{
  const invalid=[
    source('on 1 -> {11;} default -> {42;} default -> {0;}'),
    source('default -> {42;} on 1 -> {0;}'),
    source('default when true -> {42;}'),
    source('default as item -> {42;}'),
    source('on default when true -> {42;}'),
    source('on 1 -> {11;} on 1 -> {42;} default -> {0;}'),
    'pub fnc main():int { return match<int> 99 on 1 -> {11;} default -> {42;} end; }',
    source('on 1 -> {11;} default {42;}')
  ];
  for(const fixture of invalid){
    assert.throws(()=>compileToProgramIRV2(fixture),/error: program v2:/,fixture);
    assert.throws(()=>compileProgramV2(fixture),/error: program v2:/,fixture);
  }
});
test('map/record tilde shapes remain fail closed rather than lowering to unchecked JS',()=>{
  for(const body of [
    '~map<string,int>("x" => 42)',
    '~map("x" => 42)',
    '~("x" => 42)',
    '~record(foo: 42)',
    '~(foo: 42)',
    '~()'
  ]){
    const program='pub fnc main():int { return '+body+'; }';
    assert.throws(()=>compileProgramV2(program),/error: program v2:/,body);
  }
});
