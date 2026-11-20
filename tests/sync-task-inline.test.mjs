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

test('empty sync task and do sync task run inline and discard only after evaluation',async()=>{
  assert.equal(await execute(main('sync task {}; do sync task<void> {} do sync task { return 13 * 3; }; return 42;')),'42');
  assert.equal(await execute(main('do sync task<int> { return 4 + 2; }; return 42;')),'42');
  const {module_source}=transpile_to_worker(main('do sync task<int> { return 40; }; return sync task<int> { return 42; };'));
  assert.doesNotMatch(module_source,/TaskSpawn|TaskJoin|new Worker|new Promise|worker_threads/);
  assert.match(module_source,/\(\(\)=>\{return 40n;\}\)\(\)/);
});

test('discarded inline work still traps before following parent return',async()=>{
  const {module_source}=transpile_to_worker(main('do sync task { return 9223372036854775807 + 1; }; return 1;'));
  const mod=await import('data:text/javascript,'+encodeURIComponent(module_source));
  await assert.rejects((await mod.create_tenant({})).on_message(),/E_GUEST_PANIC_1/);
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
    'return sync task { val x = 2; return x; };',
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
