import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileVerifiedStrict} from '../src/program-v2.mjs';
const src=body=>'pub fnc main(): int { '+body+' }';
test('typed ordinary bool and string locals execute real generated ESM',async()=>{
  for(const body of ['let bool ready = true; if ready do return 42; else return 0; fi','val bool ready = false; if !ready do return 42; else return 0; fi','let string label = "hello"; val string copy = label; return 42;','val string label = ""; return 42;']){
    const js=compileProgramV2(src(body));
    const guest=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
    assert.equal(guest.main(),42n,body);
  }
});
test('typed local mismatch, rebinding, unsupported text and strict profile reject',()=>{
  for(const body of ['let bool x = 1; return 42;','let string x = true; return 42;','let string x = "é"; return 42;','let string x = "'+'a'.repeat(257)+'"; return 42;','let bool x = true; x = false; return 42;','val string x = "hi"; return x;'])
    assert.throws(()=>compileProgramV2(src(body)),undefined,body);
  assert.throws(()=>compileVerifiedStrict('type Bounded = int where self >= 1 and self <= 42; '+src('val bool x = true; return 42;')));
});
