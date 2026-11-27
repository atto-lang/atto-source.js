import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const main=b=>'pub fnc main():int{'+b+'}';
async function execute(source,want='D'){
 assert.throws(()=>compileProgramV2(source),/E_PERMISSION/);
 const ir=compileToProgramIRV2(source,true);assert.throws(()=>compileProgramIRV2(ir),/E_PERMISSION/);
 const js=compileProgramV2(source,true);assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir)),true),js);
 const m=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));
 assert.throws(()=>m.main(),/E_PERMISSION/);for(const g of [undefined,false,1,{},'true'])assert.throws(()=>m.runWithDeferredStdout(g),/E_PERMISSION/);
 for(let i=0;i<2;i++)assert.deepEqual(m.runWithDeferredStdout(true),{value:42n,stdout:want});
}
const source=alias=>main('let int count=0;val Option<int> missing=None;val Result<int,Error> failure=trap! sync task<int>{count=count+2;defer '+alias+'("D");val int value=missing.unwrap();count=count+100;return value;};guard failure.is_err(),count eq 2{return 1;}return count+40;');
test('canonical aliases, permissions and invocation isolation',async()=>{for(const alias of ['stdio.out.write','process.stdout.write'])await execute(source(alias));});
test('LIFO, lazy registration and lexical cleanup order',async()=>{
 await execute(main('let int n=0;val int r=sync task<int>{defer stdio.out.write("A");defer process.stdout.write("B");defer n=2;return 40;};return r+n;'),'BA');
 await execute(main('val Option<int> m=None;val Result<int,Error> r=trap! sync task<int>{defer stdio.out.write("D");val int v=m.unwrap();defer process.stdout.write("X");return v;};guard r.is_err(){return 1;}return 42;'));
 await execute(main('return true ? 42 : sync task<int>{defer stdio.out.write("X");return 1;};'),'');
});
test('reject wrong spelling, type, arity, newline, oversized, and shadowed identity',()=>{
 for(const x of ['stdio.stdout.write("D")','stdio.err.write("D")','process.stderr.write("D")','stdio.out.write(42)','process.stdout.write("D","X")','stdio.out.write("\\n")','stdio.out.write("'+ 'a'.repeat(257)+'")'])assert.throws(()=>compileProgramV2(main('return sync task<int>{defer '+x+';return 42;};'),true),x);
 assert.throws(()=>compileProgramV2(main('let int stdio=0;return sync task<int>{defer stdio.out.write("D");return 42;};'),true),/unshadowed/);
 assert.throws(()=>compileProgramV2(main('return sync task<int>{'+ 'defer stdio.out.write("D");'.repeat(17)+'return 42;};'),true),/quota/);
});
test('forged serialized IR must not create authority',()=>{
 const ir=compileToProgramIRV2(source('stdio.out.write'),true);const find=(x,k)=>x&&typeof x==='object'?(x.kind===k?x:Object.values(x).map(y=>find(y,k)).find(Boolean)):undefined;
 const bad=JSON.parse(JSON.stringify(ir));find(bad,'deferStdout').text='\\n';assert.throws(()=>compileProgramIRV2(bad,true),/literal or output quota/);
 assert.throws(()=>compileProgramIRV2(ir,{}),/E_PERMISSION/);
});
if(process.env.ATTO_SHARED_GUARD_DIR)test('execute byte-pinned shared fixtures unchanged',async()=>{for(const file of ['trap-sync-task-defer.atto','trap-sync-task-defer-process.atto'])await execute(readFileSync(process.env.ATTO_SHARED_GUARD_DIR+'/'+file,'utf8'));});
