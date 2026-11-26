import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';
import {parseStructuralProjectionSource,StructuralSourceError} from '../src/structural-source.mjs';

async function execute(source) {
  const {module_source}=transpile_to_worker(source);
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(module_source));
  const tenant=await mod.create_tenant({tenant:'a',generation:1});
  return (await tenant.on_message()).value;
}
const main=body=>'pub fnc main(): int { '+body+' }';

test('typed and inferred sync task execute as inline scalar expressions',async()=>{
  for(const [body,want] of [
    ['return sync task<int> { return 40 + 2; };','42'],
    ['return sync task { return 6 * 7; };','42'],
    ['return 1 + sync task<int> { return 40 + sync task { return 1; }; };','42'],
    ['return sync /* separated */ task < int > { return -9223372036854775808; };','-9223372036854775808'],
  ])assert.equal(await execute(main(body)),want,body);
});

test('void-only do sync task statements execute inline with no independent scheduling',async()=>{
  assert.equal(await execute(main('do sync task {}; do sync task<void> {} do sync task { return; }; return 42;')),'42');
  assert.equal(await execute(main('do sync task<void> { return; }; return 42;')),'42');
  const {module_source}=transpile_to_worker(main('do sync task<void> { return; }; return sync task<int> { return 42; };'));
  assert.doesNotMatch(module_source,/TaskSpawn|TaskJoin|new Worker|new Promise|worker_threads/);
  assert.match(module_source,/\(\(\)=>\{\}\)\(\)/);
});

test('do required for discard, but return sync task produces value',async()=>{
  const valid=`pub fnc main(): int {
    do sync task {};

    return sync task<int> {
        return 40 + 2;
    };
}`;
  assert.equal(await execute(valid),'42');
  const invalid=valid.replace('do sync task {};','sync task {};');
  assert.throws(()=>transpile_to_worker(invalid),
    error=>error instanceof TranspileError&&error.code==='E_SYNTAX');
  for(const bare of ['sync task {};','sync task {}','sync task<int> { return 42; };']){
    assert.throws(()=>transpile_to_worker(main(bare+' return 7;')),
      error=>error instanceof TranspileError&&error.code==='E_SYNTAX');
  }
});

test('checked arithmetic in a value-producing inline task still traps',async()=>{
  const {module_source}=transpile_to_worker(main('return sync task<int> { return 9223372036854775807 + 1; };'));
  const mod=await import('data:text/javascript,'+encodeURIComponent(module_source));
  await assert.rejects((await mod.create_tenant({})).on_message(),/E_GUEST_PANIC_1/);
});

test('do sync task is void-only even if the value could otherwise be discarded',()=>{
  for(const statement of [
    'do sync task<int> { return 42; };',
    'do sync task<int> {};',
    'do sync task<bool> {};',
    'do sync task<Future<int>> { return 42; };',
    'do sync task { return 42; };',
    'do sync task<void> { return 42; };',
    'do sync task { return sync task<int> { return 42; }; };',
    'do sync task /* comment */ < int > { return 42; };',
    'do sync task { return 9223372036854775807 + 1; };'
  ]) {
    assert.throws(()=>transpile_to_worker(main(statement+' return 0;')),
      error=>error instanceof TranspileError&&error.code==='E_TASK_RETURN_TYPE',
      statement);
  }
  for(const body of [
    'do sync task {};',
    'do sync task<void> {};',
    'do sync task { return; };',
    'do sync task<void> { return; };'
  ]) {
    assert.doesNotThrow(()=>transpile_to_worker(main(body+' return 42;')),body);
  }
});

test('unsupported spawned/suspending/ill-typed task input fails before an artifact',()=>{
  const bad=[
    'return task<int> { return 42; };',
    'return await task<int> { return 42; };',
    'do task<int> { return 1; }; return 0;',
    'return sync task<Future<int>> { return 42; };',
    'return sync task<bool> { return 42; };',
    'return sync task<int> {};',
    'return sync task<void> {};',
    'return sync task<void> { return 42; };',
    'return sync task { return sync task<void> {}; };',
    'return sync task { return 1; return 2; };',
    'return sync task { await task<int> { return 1; } };',
    'return sync task { using guard = new Mutex<int>(0); return 1; };',
    'return sync task { val x = 2; x = 3; return x; };',
    'sync task {}; return 42;',
    'sync task {} return 42;',
    'sync task { return 1; }; return 42;',
    'do sync task {}; sync task {}; return 42;',
    'do sync task {} sync task {} return 42;',
    'sync task { return 1; }; do task<int> {return 2;} return 42;',
  ];
  for(const body of bad)
    assert.throws(()=>transpile_to_worker(main(body)),TranspileError,body);
});

test('token keyword boundary ignores comment text; sync is reserved in other source frontend',()=>{
  const plain=main('return 42;');
  const annotated='// sync task<int> { return 99; }\n'+plain;
  assert.equal(transpile_to_worker(annotated).module_source,transpile_to_worker(plain).module_source);
  const source=[
    'define class sync as pub val int id = 42; end',
    'fnc get({id:int} v):int{return v.id;}',
    'pub fnc main():int{return get(new sync());}'
  ].join('\n');
  assert.throws(()=>parseStructuralProjectionSource(source),StructuralSourceError);
});

test('inline integer admission bounds BigInt work before conversion',async()=>{
  for(const text of ['0'.repeat(16000)+'42','0'.repeat(16000)]) {
    assert.equal(await execute(main('return sync task<int> { return '+text+'; };')),
      text.endsWith('42')?'42':'0');
  }
  for(const number of [
    '9'.repeat(16000),'1'+'0'.repeat(16000),
    '9223372036854775808','0'.repeat(15000)+'9223372036854775808'
  ]) {
    assert.throws(()=>transpile_to_worker(main(
      'return sync task<int> { return '+number+'; };')),
      error=>error instanceof TranspileError&&error.code==='E_INT_OVERFLOW');
  }
  assert.equal(await execute(main('return sync task<int> {return -'+
    '0'.repeat(1000)+'9223372036854775808;};')),'-9223372036854775808');
  assert.throws(()=>transpile_to_worker(main('return -'+
    '0'.repeat(1000)+'9223372036854775809;')),
    error=>error instanceof TranspileError&&error.code==='E_INT_OVERFLOW');
});

test('inline task fail-closed syntax, nesting and budget limits',()=>{
  for(const body of [
    'do sync /* note */ task < int > { return 42; }; return 0;',
    'do sync task<void> { return 42; }; return 0;',
    'do sync task { return 9223372036854775807+1; }; return 0;',
    'do sync task<Future<int>> {}; return 0;',
    'do sync task { await task<int>{return 1;}; }; return 0;',
    'sync task{}; return 0;',
    'do sync task<void> { val x = 1; x = 2; }; return 0;',
    'do sync task<void> { return; return; }; return 0;',
    'do sync task<void> { return; }; return sync task<void> {};'
  ])assert.throws(()=>transpile_to_worker(main(body)),TranspileError,body);
  const deep=Array.from({length:70},()=> 'sync task<int> {return ').join('')+
    '42'+Array.from({length:70},()=>';}').join('');
  assert.throws(()=>transpile_to_worker(main('return '+deep+';')),
    error=>error instanceof TranspileError&&error.code==='E_NESTING_LIMIT');
  const many=Array.from({length:65},()=> 'do sync task<void> {};').join(' ');
  assert.throws(()=>transpile_to_worker(main(many+' return 42;')),
    error=>error instanceof TranspileError&&error.code==='E_TASK_LIMIT');
  for(const tail of ['\u202e','\u0000','\u001b']) {
    assert.throws(()=>transpile_to_worker('// hostile'+tail+'\n'+main(
      'do sync task {}; return 42;')),TranspileError);
  }
  assert.throws(()=>transpile_to_worker(main(
    'return sync task<int> {return 42;}; import("host")')),TranspileError);
});

test('typed lexical task writeback and lazy scalar branches execute',async()=>{
  for(const body of [
    'let int n = 0; val int r = sync task<int> { n = 2; return 40; }; return r+n;',
    'let int n = 40; do sync task<void> { n = n+2; return; }; return n;',
    'let int n = 42; do sync task { val int n = 1; }; return n;',
    'val int r = sync task<int> { val x = 40; return x+2; }; return r;',
    'let int n = 0; val int r = true ? sync task<int> { n = 2; return 40; } : sync task<int> { n = 99; return 1; }; return r+n;',
    'let int n = 0; val int r = if false then sync task<int> { n = 99; return 1; } else sync task<int> { n = 3; return 39; } fi; return r+n;',
    'let int n = 0; val bool r = false && sync task<bool> { n = 99; return true; }; return r ? 1 : n+42;',
    'let int n = 0; val bool r = true || sync task<bool> { n = 99; return false; }; return r ? n+42 : 1;',
    'let int n = 0; val bool r = true && sync task<bool> { n = 2; return true; }; return r ? n+40 : 1;',
    'let int n = 0; val bool r = false || sync task<bool> { n = 3; return false; }; return r ? 1 : n+39;',
    'return Xor(true, true && false) ? 42 : 1;',
    'return true XOR true AND false ? 42 : 1;',
    'let int n = 0; val bool r = Xor(true, sync task<bool> { n = 2; return false; }); return r ? n+40 : 1;'
  ])assert.equal(await execute(main(body)),'42',body);
});
test('lexical task writeback rejects invalid scope, mutability and type',()=>{
  for(const [body,code] of [
    ['val int n = 0; do sync task { n = 2; }; return n;','E_IMMUTABLE_ASSIGNMENT'],
    ['let int n = 0; do sync task { n = true; }; return n;','E_TASK_RETURN_TYPE'],
    ['do sync task { val x = 42; }; return x;','E_UNBOUND'],
    ['let int n = 0; val int n = 42; return n;','E_DUPLICATE_LOCAL'],
    ['val int n = sync task<void> {}; return n;','E_TASK_RETURN_TYPE'],
    ['val int n = true ? 42 : false; return n;','E_TASK_RETURN_TYPE'],
    ['val bool n = 1 && true; return 42;','E_TASK_RETURN_TYPE'],
    ['do sync task { defer {}; }; return 42;','E_UNSUPPORTED_SYNTAX']
  ])assert.throws(()=>transpile_to_worker(main(body)),e=>e instanceof TranspileError&&e.code===code,body);
});

test('canonical compound XOR uses typed mutable lexical slots and original value',async()=>{
  for(const [body,want] of [
    ['let int x = 12; x ^^= 10; return x;','6'],
    ['let int x = -9223372036854775808; x ^^= -1; return x;','9223372036854775807'],
    ['let int x = 9223372036854775807; x ^^= -1; return x;','-9223372036854775808'],
    ['let int x = -9223372036854775808; x ^^= x; return x;','0'],
    ['let int x = 12; let int n = 0; x ^^= sync task<int> { n = n+1; return 10; }; return x*10+n;','61'],
    ['let int x = 12; x ^^= sync task<int> { x = 99; return 10; }; return x;','6'],
    ['let int x = 12; do sync task { x ^^= 10; }; return x;','6'],
    ['let int x = 12; do sync task { let int x = 10; x ^^= 3; }; return x;','12'],
    ['return Xor(true,false) ? 42 : 1;','42'],
    ['return (11 ^^ 4) eq 15 ? 42 : 1;','42']
  ])assert.equal(await execute(main(body)),want,body);
});
test('compound and Boolean caret rejection preserves the integer-only contract',()=>{
  for(const [body,code] of [
    ['val int x = 12; x ^^= 10; return x;','E_IMMUTABLE_ASSIGNMENT'],
    ['let int x = 12; x ^^= true; return x;','E_TASK_RETURN_TYPE'],
    ['let bool x = true; x ^^= false; return 0;','E_TASK_RETURN_TYPE'],
    ['return true ^^ false ? 42 : 1;','E_TASK_RETURN_TYPE'],
    ['return 11 ^^ 4 eq 15 ? 42 : 1;','E_TASK_RETURN_TYPE'],
    ['return Xor(1,2) ? 42 : 1;','E_TASK_RETURN_TYPE'],
    ['let int x = 12; x ^^ = 10; return x;','E_UNSUPPORTED_SYNTAX'],
    ['let int x = 12; x ^/*gap*/^= 10; return x;','E_UNSUPPORTED_SYNTAX']
  ])assert.throws(()=>transpile_to_worker(main(body)),e=>e instanceof TranspileError&&e.code===code,body);
});


test('inline task writeback, lazy branches and panic preserve one-shot tenant execution',async()=>{
  for(const [body,want] of [
    ['let int n = 0; val bool r = false && sync task<bool> { n = 99; return true; }; return r ? 1 : n+42;','42'],
    ['let int n = 0; val bool r = Xor(true, sync task<bool> { n = 2; return false; }); return r ? n+40 : 1;','42'],
    ['let int x = 12; x ^^= sync task<int> { x = 99; return 10; }; return x;','6'],
    ['return sync task<int> { return 9223372036854775807 + 1; };',null]
  ]){
    const {module_source}=transpile_to_worker(main(body));
    const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(module_source));
    for(const generation of [1,2]){
      const tenant=await mod.create_tenant({tenant:'inline-replay-test',generation});
      if(want===null) await assert.rejects(()=>tenant.on_message(),/E_GUEST_PANIC_1/);
      else assert.deepEqual(await tenant.on_message(),{value:want,stdout:'',actors:0});
      await assert.rejects(()=>tenant.on_message(),/E_MAIN_ALREADY_CALLED/);
    }
  }
});
