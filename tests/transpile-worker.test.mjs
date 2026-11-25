import test from 'node:test';import assert from 'node:assert/strict';
import {transpile_to_worker as transpile} from '../src/transpile-worker.mjs';
const load=async(src)=>{
  const {module_source}=transpile(src);
  return import('data:text/javascript;charset=utf-8,'+encodeURIComponent(module_source));
};
test('compiles to independently instantiable worker handler',async()=>{
  const mod=await load('pub fnc main(): int { return 6 * 7; }');
  const a=await mod.create_tenant({tenant:'a',generation:1});
  const b=await mod.create_tenant({tenant:'b',generation:1});
  assert.equal((await a.on_message()).value,'42');
  assert.equal((await b.on_message()).value,'42');
  await assert.rejects(a.on_message(),/E_MAIN_ALREADY_CALLED/);
});
test('parentheses, negative signed range, and checked math',async()=>{
  const mod=await load('fnc main(): int { return -(2 + 5) * (3 - 1); }');
  assert.equal((await (await mod.create_tenant({})).on_message()).value,'-14');
  const min=await load('pub fnc main(): int { return -9223372036854775808; }');
  assert.equal((await (await min.create_tenant({})).on_message()).value,'-9223372036854775808');
  const overflow=await load('pub fnc main(): int { return 9223372036854775807 + 1; }');
  await assert.rejects((await overflow.create_tenant({})).on_message(),/E_GUEST_PANIC_1/);
});
test('does not compile unsupported statements or injection',()=>{
  for(const src of ['pub fnc main(): int { return 0; } ;',
     'pub fnc main(): int { stdio.println("hi"); return 0; }',
     'pub fnc main(): int { return 1 / 0; }',
     'pub fnc main(): int { return 9223372036854775808; }',
     'pub fnc main(): int { return 0; } import("evil")',
     'pub fnc main(): int { return (1; }']){
    assert.throws(()=>transpile(src));
  }
});
