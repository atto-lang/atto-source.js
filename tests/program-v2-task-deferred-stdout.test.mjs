import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
 for(const payload of [String.fromCharCode(10),String.fromCharCode(13),String.fromCharCode(127),'a'.repeat(257),42]){const bad=JSON.parse(JSON.stringify(ir));find(bad,'deferStdout').text=payload;assert.throws(()=>compileProgramIRV2(bad,true),/literal or output quota/);}
 assert.throws(()=>compileProgramIRV2(ir,{}),/E_PERMISSION/);
});
const gitBlob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const exactMixed="pub fnc main(): int {\n  let int count = 0;\n  val Option<int> missing = None;\n  val Result<int, Error> failure = trap! sync task<int> {\n    count = count + 2;\n    defer stdio.out.write(\"D\");\n    defer process.stdout.write(\"E\");\n    val int value = missing.unwrap();\n    count = count + 100;\n    return value;\n  };\n  guard failure.is_err(), count eq 2 { return 1; }\n  return count + 40;\n}\n";
test('execute exact canonical stdout v1 trapped task from #703',async()=>{
 assert.equal(gitBlob(Buffer.from(exactMixed)), '5b122c0396240cee7d0be125f952655560b1e78d');
 await execute(exactMixed,'ED');
});
test('both receiver names reject lexical shadowing and extra grant arguments',async()=>{
 for(const [receiver,alias] of [['stdio','stdio.out.write'],['process','process.stdout.write']]){
  for(const src of [main('let int '+receiver+'=0;return sync task<int>{defer '+alias+'("D");return 42;};'),main('return sync task<int>{let int '+receiver+'=0;defer '+alias+'("D");return 42;};')])
   assert.throws(()=>compileProgramV2(src,true),/unshadowed/);
 }
 const js=compileProgramV2(exactMixed,true);
 const m=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));
 assert.throws(()=>m.runWithDeferredStdout(true,true),/E_PERMISSION/);
 assert.deepEqual(m.runWithDeferredStdout(true),{value:42n,stdout:'ED'});
});
if(process.env.ATTO_SHARED_GUARD_DIR)test('execute byte-pinned shared fixtures unchanged',async()=>{
 for(const [file,sha] of [['trap-sync-task-defer.atto','bcd5e2692aaaaf4c4c070a5746cd6c3ab9e5082a'],['trap-sync-task-defer-process.atto','c511c17818f725c9fc5d52a129ca257790276477']]){
  const bytes=readFileSync(process.env.ATTO_SHARED_GUARD_DIR+'/'+file);
  assert.equal(gitBlob(bytes),sha,'shared fixture identity');
  await execute(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }
});
