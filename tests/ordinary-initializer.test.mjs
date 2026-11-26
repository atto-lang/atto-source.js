import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2} from '../src/program-v2.mjs';
const source=body=>'pub fnc main(): int { '+body+' }';
test('ordinary local declaration without initializer rejects before emitting ESM',()=>{
  for(const body of ['int x; return 42;', 'let int x; return 42;', 'val int x; return 42;', 'const int x; return 42;', 'let x: int; return 42;', 'val bool x; return 42;', 'let string x; return 42;']){
    assert.throws(()=>compileProgramV2(source(body)),/E_MISSING_INITIALIZER/,body);
  }
});
test('ordinary initialized int let and val execute and unsupported reassignment rejects',async()=>{
  for(const body of ['let int x = 42; return x;', 'val int x = 42; return x;']){
    const js=compileProgramV2(source(body));
    const guest=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
    assert.equal(guest.main(),42n);
  }
  assert.throws(()=>compileProgramV2(source('let int x = 42; x = 43; return x;')));
});
