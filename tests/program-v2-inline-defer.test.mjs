import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const main=body=>'pub fnc main():int{'+body+'}';
async function execute(body){
  const source=main(body),ir=compileToProgramIRV2(source),js=compileProgramV2(source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),js);
  return (await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js))).main();
}
test('bounded lexical defer executes on return and checked error, in LIFO order',async()=>{
  for(const body of [
    'let int n=0;val int r=sync task<int>{defer n=42;n=1;return 0;};return n+r;',
    'let int n=0;val int r=sync task<int>{defer n=42;defer n=7;return 0;};return n+r;',
    'let int n=0;val Option<int> x=Option.none();val Result<int,Error> r=trap! sync task<int>{defer n=42;val int v=x.unwrap();defer n=99;return v;};guard r.is_err(){return 1;}return n;',
    'let int n=0;val Result<int,Error> r=trap! sync task<int>{defer n=42;defer n=7;return 1/0;};guard r.is_err(){return 1;}return n;',
    'let int n=42;val int r=true ? 0 : sync task<int>{defer n=99;return 1;};return n+r;',
    'let int n=0;val int r=sync task<int>{defer n=2;return 40;};return n+r;'
  ]) assert.equal(await execute(body),42n,body);
});
test('reject nonliteral, immutable, absent, local-task and effectful cleanup',()=>{
  for(const body of [
    'val int n=0;return sync task<int>{defer n=42;return n;};',
    'return sync task<int>{defer n=42;return 0;};',
    'let int n=0;return sync task<int>{defer n=n+1;return n;};',
    'let int n=0;return sync task<int>{defer n=1/0;return n;};',
    'return sync task<int>{let int n=0;defer n=42;return n;};',
    'return sync task<int>{defer stdio.out.write("D");return 42;};',
    'let int n=0;return task<int>{defer n=42;return n;};'
  ]) assert.throws(()=>compileProgramV2(main(body)),body);
});
test('serialized deferred write requires active mutable slot and literal RHS',()=>{
  const src=main('let int n=0;val int r=sync task<int>{defer n=42;return 0;};return n+r;');
  const ir=JSON.parse(JSON.stringify(compileToProgramIRV2(src)));
  const find=(x,k)=>x&&typeof x==='object'?(x.kind===k?x:Object.values(x).map(y=>find(y,k)).find(Boolean)):undefined;
  const immutable=JSON.parse(JSON.stringify(ir));find(immutable,'mutableIntLocal').kind='local';assert.throws(()=>compileProgramIRV2(immutable),/active mutable int/);
  const absent=JSON.parse(JSON.stringify(ir));find(absent,'deferIntLocal').slot=99999;assert.throws(()=>compileProgramIRV2(absent),/active mutable int/);
  const d=find(ir,'deferIntLocal');d.init={kind:'capture',slot:d.slot};assert.throws(()=>compileProgramIRV2(ir),/literal int/);
});
