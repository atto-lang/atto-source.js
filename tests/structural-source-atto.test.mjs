import test from 'node:test';
import assert from 'node:assert/strict';
import {compileStructuralProjectionSource,parseStructuralProjectionSource,StructuralSourceError}
  from '../src/structural-source.mjs';

const named=[
 'define interface HasId',
 '  id: int;',
 'end',
 'define class Candidate as',
 '  pub val int id = 42;',
 '  pub val string label = "hello";',
 '  val bool secret = true;',
 'end',
 'fnc take(structural HasId value): int {return value.id;}',
 'pub fnc main(): int {return take(new Candidate());}'
].join('\n');

const anon=[
 '/* outer /* nested */ comment */',
 'define class Candidate as',
 '  pub val int id = -42;',
 'end',
 'fnc take({id:int} value):int{return value.id;}',
 'pub fnc main():int{return take(new Candidate());}'
].join('\n');

async function execute(source) {
  const code=compileStructuralProjectionSource(source,{portable:true});
  assert.doesNotMatch(code,/\bimport\b|@oreslang\/source-js|@atto-lang\/source-js/);
  return (await import('data:text/javascript,'+encodeURIComponent(code))).main();
}

test('named structural interfaces compile and execute via two parameter orders',async()=>{
  assert.equal(await execute(named),42n);
  assert.equal(await execute(named.replace('structural HasId value','value: structural HasId')),42n);
});

test('anonymous readonly shapes and structural/record/struct spellings compile',async()=>{
  for(const variant of ['{id:int}','structural {id:int}','struct{id:int}',
    'record{id:int}','structural struct{id:int}','structural record{id:int}']) {
    assert.equal(await execute(anon.replace('{id:int}',variant)),-42n);
    assert.equal(await execute(anon.replace('take({id:int} value)',
      'take(value: '+variant+')')),-42n);
  }
});

test('checked scalar i64, bool and string are emitted as trusted ESM',async()=>{
  assert.equal(await execute(anon.replace('-42','-9223372036854775808')),-9223372036854775808n);
  const boolean=['define class C as pub val bool yes = true; end',
    'fnc check({yes:bool} v):bool{return v.yes;}',
    'pub fnc main():bool{return check(new C());}'].join('\n');
  assert.equal(await execute(boolean),true);
  const str=['define class C as pub val string label = "hi"; end',
    'fnc check({label:string} v):string{return v.label;}',
    'pub fnc main():string{return check(new C());}'].join('\n');
  assert.equal(await execute(str),'hi');
});

test('private fields, numeric widening and unsafe source injection fail closed',()=>{
  for(const bad of [
    named.replace('pub val int id','val int id'),
    named.replace('structural HasId value','HasId value'),
    named.replace('return value.id','return value.secret'),
    named.replace('return value.id','return value.id; process.exit(1)'),
    named.replace('id: int','id: float'),
    named.replace('id = 42','id = 9223372036854775808'),
    named.replace('fnc take','async fnc take'),
    named+' pub fnc another():int{return 3;}',
    named+' /* unterminated'
  ]) {
    assert.throws(()=>compileStructuralProjectionSource(bad,{portable:true}));
  }
});

test('exported parse contract guarantees typed-IR admissibility',()=>{
  const ir=parseStructuralProjectionSource(named);
  assert.equal(ir.kind,'readonly-scalar-projection');
  assert.equal(ir.mode,'explicit');
  assert.equal(ir.view.kind,'interface');
  assert.equal(ir.select,'id');
  assert.equal(ir.carrier.fields.length,3);
  assert.throws(()=>parseStructuralProjectionSource(named.replace(
    'pub val string label = "hello";',
    'pub val string label = "hello"; pub val int id = 5;'
  )),/invalid scalar field descriptor/);
});

test('source input never passes through JavaScript eval or arbitrary host object access',()=>{
  for(const s of ['globalThis.x = 3;', 'pub fnc main():int{return process.exit(1);}',
    anon+' // \n do nb {}']) {
    assert.throws(()=>compileStructuralProjectionSource(s,{portable:true}),StructuralSourceError);
  }
});
