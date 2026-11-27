import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const opts={allowDeferredStdout:true};
const main=body=>'pub fnc main():int{'+body+'}';
async function moduleFor(src){const ir=compileToProgramIRV2(src,opts),js=compileProgramV2(src,opts);assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir)),opts),js);return import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));}
test('canonical aliases, exact ordered bytes, error cleanup, and invocation isolation',async()=>{
  for(const ns of ['stdio.out','process.stdout']){
    const src=main('let int count=0;val Option<int> missing=None;val Result<int,Error> failure=trap! sync task<int>{count=count+2;defer '+ns+'.write("D");val int value=missing.unwrap();count=count+100;return value;};guard failure.is_err(),count eq 2{return 1;}return count+40;');
    assert.throws(()=>compileProgramV2(src),/E_PERMISSION/);
    const ir=compileToProgramIRV2(src,opts);assert.throws(()=>compileProgramIRV2(ir),/E_PERMISSION/);
    const m=await moduleFor(src);
    assert.throws(()=>m.main(),/E_PERMISSION/);assert.throws(()=>m.runWithDeferredStdout(false),/E_PERMISSION/);
    assert.deepEqual(m.runWithDeferredStdout(true),{value:42n,stdout:'D'});
    assert.deepEqual(m.runWithDeferredStdout(true),{value:42n,stdout:'D'});
  }
  const m=await moduleFor(main('return sync task<int>{defer stdio.out.write("A");defer process.stdout.write("B");return 42;};'));
  assert.deepEqual(m.runWithDeferredStdout(true),{value:42n,stdout:'BA'});
  const skipped=await moduleFor(main('val Result<int,Error> r=trap! sync task<int>{val int v=1/0;defer stdio.out.write("X");return v;};guard r.is_err(){return 1;}return 42;'));
  assert.deepEqual(skipped.runWithDeferredStdout(true),{value:42n,stdout:''});
});
test('deny unsupported output, namespace shadowing and unsupported program profiles',()=>{
  for(const statement of ['stdio.stdout.write("D")','stdio.stderr.write("D")','process.stderr.write("D")','stdio.out.write(42)','process.stdout.write("D","X")','stdio.out.write("\\n")','stdio.out.write("é")'])
    assert.throws(()=>compileProgramV2(main('return sync task<int>{defer '+statement+';return 42;};'),opts),statement);
  assert.throws(()=>compileProgramV2(main('val int stdio=0;return sync task<int>{defer stdio.out.write("D");return 42;};'),opts),/shadowed/);
  assert.throws(()=>compileProgramV2('fnc helper():int{return 1;}'+main('return sync task<int>{defer stdio.out.write("D");return 42;};'),opts),/single root main/);
});
test('quota failure is not an ordinary guest error and cannot be trapped',async()=>{
  const writes=Array.from({length:17},()=> 'defer stdio.out.write("'+ 'x'.repeat(256)+'");').join('');
  const m=await moduleFor(main('val Result<int,Error> r=trap! sync task<int>{'+writes+'return 42;};return 42;'));
  assert.throws(()=>m.runWithDeferredStdout(true),/quota exceeded/);
});
