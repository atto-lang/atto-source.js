import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2} from '../src/program-v2.mjs';
const source=body=>'pub fnc main(): int { '+body+' }';
test('root integer arrows preserve source and emit executable ESM',async()=>{
  const bodies=[
    'let int b=21; let int a <- b; return a+b;',
    'let int a=0; let int b=21; set a <- b; return a+b;',
    'let int a <- 42; return a;',
    'let int a=0; set a <- 42; return a;',
    'let int a=21; let int a <- a; return a+a;'
  ];
  for(const body of bodies){
    const code=compileProgramV2(source(body));
    const guest=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
    assert.equal(guest.main(),42n,body);
  }
});
test('unproved transfers and forbidden arrow contexts reject',()=>{
  for(const body of [
    'const int a <- 42; return a;',
    'int a <- 42; return a;',
    'val int a <- 42; return a;',
    'let int a=0; set! a <- 42; return a;',
    'let int a=0; a <- 42; return a;',
    'set missing <- 42; return 0;',
    'val int a=0; set a <- 42; return a;',
    'let int a=42; set a <- a; return a;',
    'let int a=0; val bool b=true; set a <- b; return a;',
    'let int a < - 42; return a;',
    'let int a • 42; return a;',
    'let int a <- 21+21; return a;',
    'let int a=0; set a <- 21+21; return a;'
  ])assert.throws(()=>compileProgramV2(source(body)),undefined,body);
});
