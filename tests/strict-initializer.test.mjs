import test from 'node:test';
import assert from 'node:assert/strict';
import {compileVerifiedStrict} from '../src/program-v2.mjs';
const pre='type Bounded = int where self >= 1 and self <= 42; ';
const src=body=>pre+'pub fnc main() -> int { '+body+' }';
test('strict typed declarations require explicit initializer at actual source boundary',()=>{
  for(const body of ['val int x; return 42;', 'val x: int; return 42;', 'let int x; return 42;', 'let x: int; return 42;','let int x = 1; while x < 42 { val int y; x = x+1; } return x;']){
    assert.throws(()=>compileVerifiedStrict(src(body)),/E_MISSING_INITIALIZER:/,body);
  }
});
test('strict initialized local compiles to executing ESM',async()=>{
  for(const body of ['val int x = 42; return x;', 'let int x = 42; return x;']){
    const js=compileVerifiedStrict(src(body));
    const guest=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
    assert.equal(guest.main(),42n);
  }
});
