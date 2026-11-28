import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';
const pre='fnc f(int x,int y):int{return x*10+y;} ';
const source=expr=>pre+'pub fnc main():int{return '+expr+';}';
async function execute(src){
  const js=compileProgramV2(src);
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));
  return mod.main();
}
test('direct static fnc calls and immediate Tuple/Record apply share typed call lowering',async()=>{
  for(const [expr,want] of [
    ['f(4,2)',42n],['f.call(4,2)',42n],
    ['f.apply((4,2))',42n],['f.apply({y:2,x:4})',42n],
    ['f.apply({y=4,x:2,})',24n],['f.apply({x:40+2,y:2})',422n],
  ]) assert.equal(await execute(source(expr)),want,expr);
  const baseline=compileToProgramIRV2(source('f(4,2)'));
  assert.deepEqual(compileToProgramIRV2(source('f.call(4,2)')),baseline);
  assert.deepEqual(compileToProgramIRV2(source('f.apply((4,2))')),baseline);
  assert.equal(await execute('fnc f(int x):int{return x;} pub fnc main():int{return f.apply((42,));}'),42n);
  assert.equal(await execute('fnc f():int{return 42;} pub fnc main():int{return f.apply(());}'),42n);
  assert.equal(await execute('fnc f():int{return 42;} pub fnc main():int{return f.apply({});}'),42n);
});
test('Record fields evaluate in source order before formal permutation',async()=>{
  const src='fnc divzero():int{return 1/0;} fnc overflow():int{return 9223372036854775807+1;} '+source('f.apply({y:divzero(),x:overflow()})');
  await assert.rejects(()=>execute(src),/ORES_I64_DIVISION_BY_ZERO/);
});
test('invalid products and shadowed references do not acquire callable authority',()=>{
  for(const expr of ['f.apply(4)','f.apply((4))','f.apply([4,2])','f.apply({x:4,x:2})','f.apply({z:4,y:2})','f.apply({x:4})','f.apply((4,true))','f.call(4)','f.apply({x:4,y:true})']){
    assert.throws(()=>compileProgramV2(source(expr)),undefined,expr);
  }
  assert.throws(()=>compileProgramV2(pre+'pub fnc main(int f):int{return f.apply((4,2));}'),/E_CALLABLE_APPLY_PROFILE/);
  assert.throws(()=>compileProgramV2(pre+'pub fnc main():int{val f=1;return f.apply({x:4,y:2});}'),/E_CALLABLE_APPLY_PROFILE/);
});
