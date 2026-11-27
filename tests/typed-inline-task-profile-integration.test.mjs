import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const main=body=>'pub fnc main():int { '+body+' }';
const load=async(body,opts)=>{
  const source=main(body),ir=compileToProgramIRV2(source,opts);
  const esm=compileProgramV2(source,opts);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir)),opts),esm);
  return import('data:text/javascript,'+encodeURIComponent(esm));
};
test('scalar inline tasks survive checked-effect integration',async()=>{
  for(const body of [
    'return sync task { return 42; };',
    'return sync task<int> { let int n=40; n=n+2; return n; };',
    'return sync task<int> { return 40+sync task<int>{return 2;}; };',
    'return sync task<int> { ^ 42; };',
    'return sync task<int> { val int n=40; return n+2; };',
    'let int n=0; val int r=sync task<int>{n=2;return 40;};return n+r;'
  ])assert.equal((await load(body)).main(),42n,body);
});
test('checked-effect task retains writeback and LIFO cleanup',async()=>{
  const body='let int count=0; val Option<int> x=None; val Result<int, Error> r=trap! sync task<int>{count=count+2; defer stdio.out.write("D"); defer process.stdout.write("E"); val int n=x.unwrap(); count=count+100; return n;}; return r.is_err()?count+40:count+r.unwrap();';
  let out='';
  assert.equal((await load(body,{stdout:true})).main(s=>{out+=s;}),42n);
  assert.equal(out,'ED');
  assert.throws(()=>compileProgramV2(main(body)),/E_STDOUT_PROFILE|E_SYNC_TASK_PROFILE/);
});
test('profile selection rejects unsupported combinations without fallback',()=>{
  for(const body of [
    'return sync task<int>{val int n=40;n=42;return n;};',
    'let int n=0;return sync task {n=42;return n;};',
    'let int n=0;return sync task<int>{n=2;return sync task<int>{return 40;};};',
    'return sync task<bool>{return 42;};',
    'return sync task<int>{let int n=42;defer stdio.out.write("D");return n;};'
  ])assert.throws(()=>compileProgramV2(main(body),{stdout:true}),undefined,body);
});
test('scalar inline task overflow remains a runtime error',async()=>{
  const guest=await load('return sync task<int>{return 9223372036854775807+1;};');
  assert.throws(()=>guest.main(),/ORES_I64_OVERFLOW/);
});

test('checked-effect admission does not erase await or admit a bare helper call',()=>{
  for(const body of [
    'return sync task<int>{return await 42;};',
    'return sync task<int>{return helper();};',
    'let int n=0;return sync task<int>{n=2;return await 40;};'
  ])assert.throws(()=>compileProgramV2(main(body)+' fnc helper():int{return 42;}',{stdout:true}),/E_TASK_UNSUPPORTED/,body);
});
