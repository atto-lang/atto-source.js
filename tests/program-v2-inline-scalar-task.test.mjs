import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
async function run(source){
  const esm=compileProgramV2(source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(compileToProgramIRV2(source)))),esm);
  const guest=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
  assert.equal(guest.main(),42n,source);
}
test('program-v2 same-thread read-only inline task actual guests',async()=>{
  for(const s of [
    'pub fnc main():int{return sync task<int>{return 42;};}',
    'pub fnc main():int{val int n=40;return sync task<int>{val int x=n+2;return x;};}',
    'pub fnc main():int{val r=trap! sync task<int>{return 42;};return r.unwrap();}',
    'pub fnc main():int{val Option<int> missing=None;val Result<int,Error> r=trap! sync task<int>{val int x=missing.unwrap();return x;};guard r.is_err(){return 1;}return 42;}',
    'pub fnc main():int{val r=trap! sync task<int>{return 7/0;};guard r.is_err(){return 1;}return 42;}',
    'pub fnc main():int{return sync task<int>{if true {return 42;}else{return 0;}};}'
  ])await run(s);
});
test('inline task fail closed before ESM publication',()=>{
  for(const s of [
    'pub fnc main():int{let int n=0;return sync task<int>{n=42;return n;};}',
    'pub fnc main():int{return sync task<int>{defer stdio.stdout.write("D");return 42;};}',
    'pub fnc main():int{return sync task<int>{return true;};}',
    'pub fnc main():int{return sync task<int>{if true {return 42;}};}',
    'pub fnc main():int{return sync task<int>{return sync task<int>{return 42;};};}',
    'fnc f():int{return 42;}pub fnc main():int{return sync task<int>{return f();};}',
    'pub fnc main():int{return sync task<int>{return await 42;};}',
    'pub fnc main():int{return sync task<int>{if true {return 42;}else{return false;}};}'
  ])assert.throws(()=>compileProgramV2(s),/error: program (v2|IR):/,s);
});
