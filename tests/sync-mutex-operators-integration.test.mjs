import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

const main=body=>'pub fnc main(): int { '+body+' }';
const run=async body=>{
  const js=transpile_to_worker(main(body)).module_source;
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));
  const tenant=await mod.create_tenant({tenant:'t',generation:1});
  return (await tenant.on_message()).value;
};
test('mixed inline task, caret return, XOR and shift',async()=>{
  assert.equal(await run('do sync task<void>{return;}; ^ sync task<int>{^ 40+2;};'),'42');
  assert.equal(await run('do sync task {}; return sync task<int>{return 12 ^^ 10;};'),'6');
  assert.equal(await run('return sync task<int>{return 8 <<< 2;};'),'32');
});
test('nested generic ends do not spoof read-channel operator',()=>{
  for(const expr of ['Mutex<Option<int>>(0)','Mutex<Option<Future<int>>>(0)']) {
    assert.throws(()=>transpile_to_worker(main('return sync task<int>{return '+expr+';};')),
      err=>err instanceof TranspileError&&err.code==='E_NEW_REQUIRED');
    assert.throws(()=>transpile_to_worker(main('return sync task<int>{return new '+expr+';};')),
      err=>err instanceof TranspileError&&err.code==='E_LOCK_UNSUPPORTED');
  }
});
test('typed IO remains rejected, void payload remains enforced',()=>{
  for(const expr of ['1 >> 2','1 << 2'])
    assert.throws(()=>transpile_to_worker(main('return '+expr+';')),
      err=>err.code==='E_IO_UNSUPPORTED');
  assert.throws(()=>transpile_to_worker(main('do sync task<Future<int>> {}; return 0;')),
    err=>err.code==='E_TASK_RETURN_TYPE');
});
