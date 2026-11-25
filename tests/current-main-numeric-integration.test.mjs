import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

test('numeric integration preserves current-main guard and lazy boolean semantics',async()=>{
  for(const source of [
    'pub fnc main():int { guard false {return 42;} return 0; }',
    'pub fnc main():int {return true && false ? 0 : 42;}',
    'pub fnc main():int { val int n = 84 / 2; guard n eq 42 {return 0;} return n; }',
  ]){
    const ir=compileToProgramIRV2(source);
    const esm=compileProgramV2(source);
    assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
    const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
    assert.equal(guest.main(),42n,source);
  }
});
test('numeric integration does not open unsupported effect and ownership admission',()=>{
  for(const [source,diagnostic] of [
    ['pub fnc main():int {return copy! x;}','OWNERSHIP_BANG_BACKEND_UNSUPPORTED'],
    ['pub fnc main():int {return trap 1;}','trap requires verified ordinary-throw effect'],
    ['pub fnc main():int {select first {} return 42;}','static select requires checked'],
    ['pub fnc main():int {return panic! Error("bad");}','EXCEPTION_BANG_BACKEND_UNSUPPORTED'],
  ]) assert.throws(()=>compileProgramV2(source),e=>e.message.includes(diagnostic),source);
});
