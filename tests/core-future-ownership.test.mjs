// Actual JS production compiler-core preflight, NOT actor async guest runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIR,compile} from '../src/compiler.mjs';
const fixture=name=>readFileSync(new URL('../contracts/std-actor-v1/'+name,import.meta.url),'utf8');
const expected=[
 ['future-borrowed.reject.atto','E_OWNERSHIP'],
 ['future-double-await.reject.atto','E_MOVED'],
 ['future-use-after-await.reject.atto','E_MOVED'],
 ['future-loan-across-await.reject.atto','E_BORROW'],
 ['future-take-then-await.reject.atto','E_MOVED'],
 ['future-forged-constructor.reject.atto','E_RESERVED']
];
for(const [name,code]of expected){
  test('JS core rejects '+name+' with '+code+' before emitting JS',()=>{
    const source=fixture(name);
    assert.throws(()=>compileToIR(source),new RegExp('error: '+code+'\\b'));
    assert.throws(()=>compile(source),new RegExp('error: '+code+'\\b'));
  });
}
test('positive owned ActorFuture is blocked until typed affine IR exists',()=>{
  const src=fixture('future-owned.accept.atto');
  assert.throws(()=>compileToIR(src),/error: E_UNSUPPORTED_TYPE:/);
});
test('nested Result future does not silently flatten ownership or emit scalar JS',()=>{
  const src='use namespace std.actor; pub susp fnc f(take! ActorFuture<Result<int,String>> reply) -> Result<int,String> { return await reply; }';
  assert.throws(()=>compileToIR(src),/error: E_UNSUPPORTED_TYPE:/);
});
test('guest cannot define a sealed Future family nominal type',()=>{
  for(const src of [
    'use namespace std.actor; define class ActorFuture as end',
    'use namespace std.actor; declare actor TaskFuture;',
    'pub fnc main(): int { val item = new Future<int>(); return 42; }'
  ])assert.throws(()=>compileToIR(src),/error: E_RESERVED:/);
});
test('comments/strings resembling Future syntax are not compiler-core authorities',()=>{
  const source='pub fnc main(): int { /* ActorFuture<int> take! receipt */ return 42; }';
  assert.doesNotThrow(()=>compileToIR(source));
  assert.doesNotThrow(()=>compileToIR('pub fnc main(): int { return 42; } // ActorFuture<int>'));
});
test('scalar compiler remains executable for supported arithmetic',()=>{
  const out=compile('pub fnc main(): int { return 40 + 2; }');
  assert.match(out,/export \{/);
  assert.doesNotMatch(out,/ActorFuture/);
});
