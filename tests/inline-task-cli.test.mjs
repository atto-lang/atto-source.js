import test from 'node:test';
import assert from 'node:assert/strict';
import {compileAttoScalarV1,compileToProgramIRV2} from '../src/program-v2.mjs';
const load=source=>import('data:text/javascript,'+encodeURIComponent(compileAttoScalarV1(source)));
test('CLI scalar IR executes scoped inline tasks without scheduling',async()=>{
  for(const source of [
    'pub fnc main():int{return sync task<int>{return 40+2;};}',
    'pub fnc main():int{return sync task{val int x=40;return sync task<int>{return x+2;};};}',
    'pub fnc main():int{val int base=40;return sync task<int>{val int x=base+1;return x+1;};}',
  ]){
    const m=await load(source);
    assert.equal(m.main(),42n);
  }
});
test('CLI scalar inline task checks an unused initializer',async()=>{
  const m=await load('pub fnc main():int{return sync task<int>{val int x=9223372036854775807+1;return 42;};}');
  assert.throws(()=>m.main(),/overflow/i);
});
test('CLI scalar inline tasks reject escaping or unsupported effects',()=>{
  for(const source of [
    'pub fnc main():int{return sync task<int>{return true;};}',
    'pub fnc main():int{return sync task<int>{val int x=1;x=42;return x;};}',
    'pub fnc main():int{return sync task<int>{return await 42;};}',
    'pub fnc main():int{return sync task<int>{return task<int>{return 42;};};}',
    'pub fnc main():int{val int z=sync task<int>{val int x=42;return x;};return x;}',
    'pub fnc main():int{return sync task<int>{return helper();};} fnc helper():int{return 42;}',
    'pub fnc main():int{return sync task<void>{return 42;};}',
    'pub fnc main():int{return task { return 42; };}',
    'pub fnc main():int{return sync gpu task { return 42; };}',
    'pub fnc main():int{return sync task { return await 42; };}',
  ])assert.throws(()=>compileToProgramIRV2(source),undefined,source);
});
