import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const main=body=>'pub fnc main():int{'+body+'}';
async function run(body){const src=main(body),ir=compileToProgramIRV2(src),js=compileProgramV2(src);assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),js);const m=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));return m.main();}
test('program-v2 inline mutable int writeback and error order',async()=>{
  for(const body of [
    'let int n=0;val int r=sync task<int>{n=2;return 40;};return n+r;',
    'let int n=0;val int r=sync task<int>{n=n+1;n=n+1;return 40;};return n+r;',
    'let int n=0;val Result<int,Error> r=trap! sync task<int>{n=42;return 1/0;};guard r.is_err(){return 1;}return n;',
    'let int n=42;val Result<int,Error> r=trap! sync task<int>{n=9223372036854775807+1;return 1;};guard r.is_err(){return 1;}return n;',
    'let int n=42;val int r=true ? 0 : sync task<int>{n=99;return 1;};return n+r;'
  ]) assert.equal(await run(body),42n,body);
});
test('reject outer immutable, absent, non-int or scheduled mutation',()=>{
  for(const body of [
    'val int n=0;return sync task<int>{n=42;return n;};',
    'return sync task<int>{n=42;return n;};',
    'let bool n=false;return sync task<int>{n=42;return 42;};',
    'let int n=0;return sync task<int>{n=true;return 42;};',
    'let int n=0;return task<int>{n=42;return n;};'
  ]) assert.throws(()=>compileProgramV2(main(body)),body);
});
test('serialized IR cannot assign immutable or out-of-scope slots',()=>{
  const src=main('let int n=0;val int r=sync task<int>{n=2;return 40;};return n+r;');
  const ir=JSON.parse(JSON.stringify(compileToProgramIRV2(src)));
  const find=(x,k)=>x&&typeof x==='object'?(x.kind===k?x:Object.values(x).map(y=>find(y,k)).find(Boolean)):undefined;
  const bad=JSON.parse(JSON.stringify(ir));find(bad,'taskMutableLocal').kind='local';assert.throws(()=>compileProgramIRV2(bad),/invalid mutable capture/);
  const escaped=JSON.parse(JSON.stringify(ir));const scope=find(escaped,'taskScope');const escapedBody=scope.body;delete scope.body;Object.assign(scope,escapedBody);assert.throws(()=>compileProgramIRV2(escaped),/invalid mutable capture/);
  const wrong=JSON.parse(JSON.stringify(ir));find(wrong,'taskSet').value={kind:'bool',value:true};assert.throws(()=>compileProgramIRV2(wrong),/boolean value cannot be used as non-bool|integer/);
  find(ir,'taskSet').slot=99999;assert.throws(()=>compileProgramIRV2(ir),/invalid mutable capture/);
});
