import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIR,compileIR} from '../src/compiler.mjs';
import {validateScalarIR} from '../src/scalar-ir.mjs';
const source=body=>'pub fnc main(): int { '+body+' }';
async function guest(body) {
  const ir=compileToIR(source(body));
  const js=compileIR(ir);
  return (await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))).main();
}
test('parenthesized and bare returns produce identical typed IR and guest result',async()=>{
  const a='return seq (1,2,42);', b='return seq 1,2,42;';
  assert.deepEqual(compileToIR(source(a)),compileToIR(source(b)));
  assert.equal(await guest(a),42n);
  assert.equal(await guest(b),42n);
  assert.equal(await guest('return seq 42;'),42n);
  assert.equal(await guest('return 2+seq(7,seq(8,40));'),42n);
  assert.equal(await guest('const Record<infer R> r=(a=1,b=2,c=42); return seq r.a,r.b,r.c;'),42n);
});
test('discarded prefix still evaluates and traps',async()=>{
  for(const body of ['return seq(Integer.rem(1,0),42);','return seq Integer.rem(1,0),42;'])
    await assert.rejects(guest(body),/DIVISION_BY_ZERO|division by zero/i);
});
test('invalid sequences, tuples, missing names and prefix cycles reject',()=>{
  for(const body of ['return seq ();','return seq 1,;','return seq (1,);','return seq ;','return (1,42);','return seq missing,42;','return seq main(),42;'])
    assert.throws(()=>compileToIR(source(body)),undefined,body);
});
test('scalar IR v1 unchanged and v2 sequences structurally validated',()=>{
  const old=compileToIR(source('return 42;'));
  assert.equal(old.schemaVersion,1);
  const seq=compileToIR(source('return seq 1,42;'));
  assert.equal(seq.schemaVersion,2);
  assert.equal(seq.functions[0].body.kind,'seq');
  assert.throws(()=>validateScalarIR({...seq,schemaVersion:1}));
  assert.throws(()=>validateScalarIR({...old,schemaVersion:2}));
  const empty=structuredClone(seq); empty.functions[0].body.items=[];
  assert.throws(()=>validateScalarIR(empty));
  const invalid=structuredClone(seq); invalid.functions[0].body.items[0]={kind:'param',index:0};
  assert.throws(()=>validateScalarIR(invalid));
});

test('scoped sequence and bare final call argument compile and execute',async()=>{
  const defs='fnc id(int x): int { return x; } fnc add(int x,int y): int { return x+y; } ';
  for(const expr of ['(>1,2,42)','id(seq 1,2,42)','add(2,seq 9,40)','add(seq(7,2),40)','add((>7,2),40)','id(seq add(1,2),42)','Integer.rem(99,seq 1,57)']){
    const js=compileIR(compileToIR(defs+source('return '+expr+';')));
    assert.equal((await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))).main(),42n,expr);
  }
  for(const expr of ['add(seq 1,42)','id(seq 1,)','id(seq ,42)','id(seq 1;42)','(>1,)','Integer.rem(seq 1,2)'])
    assert.throws(()=>compileToIR(defs+source('return '+expr+';')),undefined,expr);
  const trapped=compileIR(compileToIR(defs+source('return id(seq Integer.rem(1,0),42);')));
  const guest=await import('data:text/javascript;base64,'+Buffer.from(trapped).toString('base64'));
  assert.throws(()=>guest.main(),/DIVISION_BY_ZERO|division by zero/i);
});
