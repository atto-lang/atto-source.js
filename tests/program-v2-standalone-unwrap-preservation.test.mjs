import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
test('standalone unwrap admission preserves existing checked-effect receiver profiles',async()=>{
  for(const source of [
    'pub fnc main():int { let int n=0; val Option<bool> x=Some(true); val int r=sync task<int>{n=2;return x.unwrap()?40:0;}; return n+r; }',
    'pub fnc main():int { let int n=0; val Result<int,Error> x=trap! 40; val int r=sync task<int>{n=2;return x.unwrap();}; return n+r; }',
    'fnc work(Option<int> x):int {let int n=0;val int r=sync task<int>{n=2;return x.unwrap();};return n+r;} pub fnc main():int{return work(Some(40));}',
    'pub fnc main():int{val Result<int,int> x=Result.ok(42);return sync task<int>{return x.unwrap();};}',
    'pub fnc main():int{val Option<int> x=Some(42);return sync task<int>{return x.unwrap();};}'
  ]){
    const esm=compileProgramV2(source);
    assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(compileToProgramIRV2(source)))),esm);
    assert.equal((await import('data:text/javascript,'+encodeURIComponent(esm))).main(),42n);
  }
});
test('new standalone admission remains limited to typed lexical scalar ADT unwrap',()=>{
  for(const source of [
    'pub fnc main():int{return sync task<int>{return x.unwrap();};}',
    'pub fnc main():int{val int x=42;return sync task<int>{return x.unwrap();};}',
    'pub fnc main():int{val Option<int> x=Some(42);return sync task<int>{return x.unwrap(1);};}',
    'pub fnc main():int{val Option<bool> x=Some(true);return sync task<int>{return x.unwrap()?42:0;};}'
  ])assert.throws(()=>compileProgramV2(source),/E_SYNC_TASK_PROFILE|E_TASK_UNSUPPORTED/);
});
