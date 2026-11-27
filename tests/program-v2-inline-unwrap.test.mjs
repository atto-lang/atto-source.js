import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const main=body=>'pub fnc main():int{'+body+'}';
async function execute(body){
  const source=main(body),ir=compileToProgramIRV2(source),js=compileProgramV2(source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),js);
  return (await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js))).main();
}
test('checked unwrap inside inline task preserves earlier writes and suppresses later writes',async()=>{
  for(const body of [
    'let int n=0;val Option<int> missing=Option.none();val Result<int,Error> r=trap! sync task<int>{n=2;val int value=missing.unwrap();n=100;return value;};guard r.is_err(),n eq 2{return 1;}return n+40;',
    'let int n=0;val Option<int> present=Option.some(40);val int r=sync task<int>{n=2;return present.unwrap();};return n+r;',
    'let int n=42;val Option<int> missing=Option.none();val Result<int,Error> r=trap! sync task<int>{n=missing.unwrap();return 1;};guard r.is_err(){return 1;}return n;',
    'let int n=0;val Result<int,int> failure=Result.err(7);val Result<int,Error> r=trap! sync task<int>{n=42;return failure.unwrap();};guard r.is_err(){return 1;}return n;',
    'val Result<int,int> present=Result.ok(42);return sync task<int>{return present.unwrap();};'
  ]) assert.equal(await execute(body),42n,body);
});
test('checked unwrap admission does not open arbitrary or shadowed calls',()=>{
  for(const body of [
    'val int x=42;return sync task<int>{return x.unwrap();};',
    'return sync task<int>{return missing.unwrap();};',
    'val Option<int> x=Option.some(42);return sync task<int>{return x.unwrap(1);};',
    'val Option<int> x=Option.some(42);return sync task<int>{val int x=1;return x.unwrap();};',
    'val Option<int> x=Option.some(42);return sync task<int>{return x.expect("x");};',
    'return sync task<int>{return Option.some(42);};'
  ]) assert.throws(()=>compileProgramV2(main(body)),body);
});
test('untrapped missing Option stays an ordinary error',async()=>{
  await assert.rejects(execute('val Option<int> x=Option.none();return sync task<int>{return x.unwrap();};'));
});
