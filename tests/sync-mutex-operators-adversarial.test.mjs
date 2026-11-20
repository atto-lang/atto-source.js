import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

// Trusted checked-i64 guest subset: negative checks must emit no artifact.
const main=body=>'pub fnc main(): int { '+body+' }';
const compile=body=>transpile_to_worker(main(body));
const reject=(body,code)=>assert.throws(()=>compile(body),
  error=>error instanceof TranspileError&&error.code===code,body.slice(0,110));
async function run(body){
  const output=compile(body);
  assert.equal(output.trusted,true);
  const mod=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(output.module_source));
  const handler=await mod.create_tenant({tenant:'audit',generation:1});
  return {result:await handler.on_message(),handler,js:output.module_source};
}
test('inline tasks run before the caller return without TaskSpawn or Future',async()=>{
  const {result,handler,js}=await run('do sync task<void>{^;}; ^ sync task<int>{^ 40+2;};');
  assert.equal(result.value,'42');
  assert.doesNotMatch(js,/TaskSpawn|TaskJoin|new Worker|new Promise|import\s*\(/);
  await assert.rejects(handler.on_message(),/E_MAIN_ALREADY_CALLED/);
});
test('void do task accepts empty and value-free return, never a payload',async()=>{
  for(const body of ['do sync task {}; return 42;',
    'do sync task<void> {}; return 42;',
    'do sync task {return;}; return 42;',
    'do sync task<void> {return;}; return 42;',
    'do sync task<void> {^;}; ^ 42;'])
    assert.equal((await run(body)).result.value,'42');
  for(const body of [
    'do sync task<int>{return 42;}; return 0;',
    'do sync task<int>{}; return 0;',
    'do sync task<bool>{}; return 0;',
    'do sync task<Future<int>>{}; return 0;',
    'do sync task {return 42;}; return 0;',
    'do sync task<void>{return 42;}; return 0;',
    'do sync task {^ 42;}; return 0;',
    'do sync task {return sync task<int>{return 42;};}; return 0;'])
    reject(body,'E_TASK_RETURN_TYPE');
});
test('bare discarded inline task remains forbidden',()=>{
  for(const body of ['sync task {}; return 42;',
    'sync task<int>{return 42;}; return 42;',
    'do sync task {}; sync task {}; return 42;'])
    reject(body,'E_TASK_DISCARD_REQUIRES_DO');
});
test('nested generics disambiguate closers and channel reads',()=>{
  for(const type of ['Mutex<int>','Mutex<Option<int>>',
    'Mutex<Option<Future<int>>>']){
    reject('return '+type+'(0);','E_NEW_REQUIRED');
    reject('return new '+type+'(0);','E_LOCK_UNSUPPORTED');
  }
  // Comma-separated generic arguments remain outside this restricted lexer.
  reject('return Mutex<Result<int,void>>(0);','E_UNSUPPORTED_TOKEN');
  for(const expr of ['32 >> 2','32 << 2',
    'sync task<int>{return 32 >> 2;}',
    'sync task<int>{return 32 << 2;}'])
    reject('return '+expr+';','E_IO_UNSUPPORTED');
});
test('comments never masquerade as operators or nominal resources',async()=>{
  for(const sep of ['\n','\r','\u0085','\u2028','\u2029']){
    const src='// new Mutex<Option<int>>(0) 42 >> 2'+sep+
      main('do sync task {}; ^ 42;');
    assert.equal(transpile_to_worker(src).guest_abi,'atto.js.browser.subset.v1');
  }
  assert.equal((await run('do /* hidden >> */ sync task<void>{return;}; return 42;')).result.value,'42');
});
test('signed int boundaries and typed bitwise scopes',async()=>{
  for(const [expr,value] of [
    ['-9223372036854775808','-9223372036854775808'],
    ['9223372036854775807','9223372036854775807'],
    ['12 ^^ 10','6'],['(12 ^^ 10) <<< 1','12'],
    ['-1 >>> 1','9223372036854775807'],
    ['1 <<< 64','1'],['1 <<< -1','-9223372036854775808']])
    assert.equal((await run('return sync task<int>{return '+expr+';};')).result.value,value);
  reject('return sync task<int>{return 9223372036854775808;};','E_INT_OVERFLOW');
  reject('return sync task<int>{return -9223372036854775809;};','E_INT_OVERFLOW');
});
test('checked overflow inside a nested task raises guest panic',async()=>{
  const js=compile('return sync task<int>{return sync task<int>{return 9223372036854775807+1;};};').module_source;
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));
  const handler=await mod.create_tenant({tenant:'audit',generation:1});
  await assert.rejects(handler.on_message(),/E_GUEST_PANIC_1/);
});
test('decimal length checks precede BigInt conversion',async()=>{
  const zeros='0'.repeat(16000);
  reject('return sync task<int>{return '+('9'.repeat(16000))+';};','E_INT_OVERFLOW');
  reject('return sync task<int>{return '+zeros+'9223372036854775808;};','E_INT_OVERFLOW');
  assert.equal((await run('return sync task<int>{return '+zeros+'42;};')).result.value,'42');
});
test('task count, nesting, token and byte limits remain bounded',()=>{
  reject(Array.from({length:65},()=> 'do sync task<void> {};').join(' ')+' return 0;','E_TASK_LIMIT');
  reject('return '+('('.repeat(70))+'42'+(')'.repeat(70))+';','E_NESTING_LIMIT');
  reject('return '+Array.from({length:4100},()=>'+').join(' ')+' 1;','E_TOKEN_LIMIT');
  reject('return '+('0'.repeat(65536))+';','E_SOURCE_LIMIT');
});
test('host JS and unsupported suspension/effects fail closed',()=>{
  for(const bad of [
    'do task<int>{return 42;}; return 0;',
    'return await task<int>{return 42;};',
    'return sync task<int>{return Math.pow(2,3);};',
    'return sync task<int>{return eval(42);};',
    'do sync task<void>{await task<int>{return 1;};}; return 0;',
    'do sync task<void>{using guard=new Mutex<int>(0);}; return 0;',
    'return sync task<int>{return 42;}; import("host")'])
    assert.throws(()=>compile(bad),TranspileError);
});
test('raw controls, bidi and invalid surrogate sequences are denied in comments',()=>{
  for(const tail of ['\0','\x1b','\x7f','\u202e','\u2066','\ud800','\udc00'])
    assert.throws(()=>transpile_to_worker('// attacker'+tail+'\n'+main('return 42;')),
      error=>error instanceof TranspileError);
});
