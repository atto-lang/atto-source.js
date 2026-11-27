import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileProgramIRV2,compileToProgramIRV2} from '../src/program-v2.mjs';
const main=b=>'pub fnc main():int{'+b+'}';
async function run(body){let source=main(body),js=compileProgramV2(source);assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(compileToProgramIRV2(source)))),js);return (await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js))).main();}
test('lexical defer LIFO, read at exit, register only reached and preserve result',async()=>{
 for(const b of [
 'let int n=0;val int r=sync task<int>{defer n=42;return 7;};return n;',
 'let int n=0;val int r=sync task<int>{defer n=42;defer n=7;return 0;};return n;',
 'let int n=0;let int v=0;val int r=sync task<int>{defer n=v;v=42;return 0;};return n;',
 'let int n=0;val Option<int> m=None;val Result<int,Error> r=trap! sync task<int>{defer n=42;val int v=m.unwrap();defer n=7;return v;};guard r.is_err(){return 1;}return n;',
 'let int n=0;val int r=sync task<int>{defer n=2;return 40;};return n+r;',
 'let int n=42;val int r=true ? 0 : sync task<int>{defer n=1;return 1;};return n+r;'
 ])assert.equal(await run(b),42n,b);
});
test('cleanup fails closed for immutable targets, task locals and effectful RHS',()=>{
 for(const b of ['val int n=0;return sync task<int>{defer n=42;return 0;};','return sync task<int>{let int n=0;defer n=42;return n;};','let int n=0;return sync task<int>{defer n=n+1;return 42;};','let int n=0;val Option<int> m=None;return sync task<int>{defer n=m.unwrap();return 42;};','let int n=0;return task<int>{defer n=42;return 0;};'])assert.throws(()=>compileProgramV2(main(b)),b);
});
test('serialized cleanup rejects forged mutable target and checked RHS',()=>{
 const ir=compileToProgramIRV2(main('let int n=0;val int r=sync task<int>{defer n=42;return 0;};return n;'));
 const find=(x,k)=>x&&typeof x==='object'?(x.kind===k?x:Object.values(x).map(y=>find(y,k)).find(Boolean)):undefined;
 let a=JSON.parse(JSON.stringify(ir));find(a,'taskMutableLocal').kind='local';assert.throws(()=>compileProgramIRV2(a),/invalid mutable cleanup capture/);
 a=JSON.parse(JSON.stringify(ir));find(a,'taskDeferInt').value={kind:'binary',op:'+',left:{kind:'int',value:'1'},right:{kind:'int',value:'2'}};assert.throws(()=>compileProgramIRV2(a),/cleanup requires pure int read/);
});

test('cleanup retains checked type and lexical scope',()=>{
 for(const b of ['let int n=0;val bool b=true;return sync task<int>{defer n=b;return 42;};','return sync task<int>{defer n=42;return 0;};','let int n=0;return sync task<int>{defer n=1/0;return n;};'])assert.throws(()=>compileProgramV2(main(b)),b);
 const ir=compileToProgramIRV2(main('let int n=0;val int r=sync task<int>{defer n=42;return 0;};return n;'));
 const find=(x,k)=>x&&typeof x==='object'?(x.kind===k?x:Object.values(x).map(y=>find(y,k)).find(Boolean)):undefined;
 find(ir,'taskDeferInt').slot=99999;assert.throws(()=>compileProgramIRV2(ir),/invalid mutable cleanup capture/);
});
