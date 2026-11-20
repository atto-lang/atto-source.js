// Independent JS compiler admission: no guest Mutex<T> is implemented.
// These are parser diagnostics, NOT executed mutex guests or backend parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker} from '../src/transpile-worker.mjs';

function main(expr) {
  return 'pub fnc main(): int { val counter = ' + expr + '; return 0; }';
}

for (const [name,code,diagnostic] of [
  ['old bare constructor',main('Mutex<int>(0)'),'E_NEW_REQUIRED'],
  ['new nominal resource class',main('new Mutex<int>(0)'),'E_LOCK_UNSUPPORTED'],
  ['nested generic constructor',main('new Mutex<Option<int>>(0)'),'E_LOCK_UNSUPPORTED'],
  ['nested generic bare constructor',main('Mutex<Option<int>>(0)'),'E_NEW_REQUIRED'],
]) {
  test('Mutex source admission: '+name, () => {
    assert.throws(() => transpile_to_worker(code),e=>e?.code===diagnostic);
  });
}

test('comments and unrelated type uses do not spoof a constructor',()=>{
  const reference='pub fnc main(): int { return 42; }';
  const withComments='// Mutex<int>(0) is invalid but this is a comment.\n'+reference;
  assert.equal(transpile_to_worker(reference).module_source,
    transpile_to_worker(withComments).module_source);
  assert.equal(typeof transpile_to_worker(reference).module_source,'string');
});

test('value struct spelling is not globally rewritten to a new class',()=>{
  // The present JS subset does not lower structs. Its refusal is not
  // evidence that Point(...) needs new or that Mutex(...) is allowed.
  const plain=main('Point(x=1,y=2)');
  assert.throws(()=>transpile_to_worker(plain),e=>e?.code!=='E_NEW_REQUIRED');
});
