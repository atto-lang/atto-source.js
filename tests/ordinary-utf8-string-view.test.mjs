import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';
import {validateProgramIRV2} from '../src/program-ir-v2.mjs';
const src=b=>'pub fnc main(): int { '+b+' }';
test('typed UTF-8 local snapshots and braced statements execute emitted ESM',async()=>{
  for(const body of [
    'val string x = "if"; if x eq "if" { return 42; } else { return 1; }',
    'val string x = "a\\u0000b"; if x neq "a\\u0000c" { return 42; } else { return 1; }',
    'val string x = "café"; if x neq "cafe\\u0301" { return 42; } else { return 1; }',
    'let string x = "first"; val string old = x; x = "second"; if old eq "first" { if x eq "second" { return 42; } else { return 2; } } else { return 1; }',
    'val string x = "a\\nb"; if x neq "anb" { return 42; } else { return 1; }',
    'val string x = "true"; if x eq "true" { return 42; } else { return 1; }',
    'val string x = "else"; if true do if x eq "else" { return 42; } else { return 1; } fi return 2;'
  ]){
    const js=compileProgramV2(src(body));
    assert.equal(compileProgramV2(src(body)),js);
    const guest=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
    assert.equal(guest.main(),42n,body);
  }
});
test('deny invalid types, forged UTF-16, shadowing and branch rebinding',()=>{
  for(const body of [
    'val string x = 1; return 42;',
    'val string x = "a"; x = "b"; return 42;',
    'let string x = "a"; x = 1; return 42;',
    'let string x = "a"; if true { x = "b"; } return 42;',
    'val string x = "\\uD800"; return 42;',
    'val string x = "'+'é'.repeat(129)+'"; return 42;',
    'val string x = "a"; if x eq 1 { return 42; } else { return 1; }',
    'val string x = "a"; if x { return 42; } else { return 1; }',
    'val string x = "a"; val string x = "b"; return 42;',
    'x = "a"; return 42;'
  ])assert.throws(()=>compileProgramV2(src(body)),undefined,body);
  const ir=compileToProgramIRV2(src('val string x = "a"; if x eq "a" { return 42; } else { return 1; }'));
  const replace=(obj)=>{
    if(obj&&typeof obj==='object'){
      if(obj.kind==='string'){obj.value='\uD800';return true;}
      return Object.values(obj).some(replace);
    }return false;
  };
  const bad=JSON.parse(JSON.stringify(ir));
  assert.ok(replace(bad));assert.throws(()=>validateProgramIRV2(bad));
});
