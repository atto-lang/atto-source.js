import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIR,compileIR} from '../src/compiler.mjs';
const run = async body => {
  const ir=compileToIR('pub fnc main(): int { '+body+' }');
  const js=compileIR(ir);
  const mod=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  return mod.main();
};
test('named literal scalar aggregates reuse types and compile integer projections',async()=>{
  assert.equal(await run(`
    const Record<infer T1> r = (a=true,b="xyz",c=5);
    const Tuple<infer T2> t = (true,"xyz",5);
    const struct<infer T3> s = {a:true,b:"xyz",c:5};
    const Record<T1> r2 = (c=10,b="abc",a=false);
    const Tuple<T2> t2 = (false,"abc",12);
    const struct<T3> s2 = {c:20,b:"abc",a:false};
    return r2.c + t2[2] + s2.c;
  `),42n);
});
test('bare annotation remains anonymous and does not create a type',async()=>{
  assert.equal(await run('const Record r=(a=42); return r.a;'),42n);
  assert.throws(()=>compileToIR('pub fnc main(): int { const Record r=(a=42); const Record<T> s=(a=42); return 0; }'),/E_UNKNOWN_TYPE/);
});
test('reject bad named aggregate declarations before IR',()=>{
  for(const [body,error] of [
    ['const Record<infer> r=(a=1);',/identifier/],
    ['const Record<T> r=(a=1);',/E_UNKNOWN_TYPE/],
    ['const Record<infer T> r=(a=1); const Tuple<infer T> t=(1,2);',/E_DUPLICATE_TYPE/],
    ['const Record<infer T> r=(a=1,a=2);',/E_DUPLICATE_FIELD/],
    ['const Record<infer T> r=(a=1); const Record<T> s=(a=true);',/E_TYPE_MISMATCH/],
    ['const Record<infer T> r=(a=1); const Record<T> s=(a=1,b=2);',/E_TYPE_MISMATCH/],
    ['const Record<infer T> r=(a=1,b=2); const Record<T> s=(a=1);',/E_TYPE_MISMATCH/],
    ['const Tuple<infer T> r=(1,true); const Tuple<T> s=(true,1);',/E_TYPE_MISMATCH/],
    ['const Tuple<infer T> r=(1,true); const Tuple<T> s=(1);',/E_TYPE_MISMATCH/],
    ['const struct<infer T> r={a:1}; const Record<T> s=(a=1);',/E_AGGREGATE_KIND/],
    ['const Record<infer T> r=(a=unknown);',/E_TYPE_INFER_AMBIGUOUS/],
  ])assert.throws(()=>compileToIR('pub fnc main(): int { '+body+' return 0; }'),error);
  assert.throws(()=>compileToIR('fnc other(): int { const Record<infer T> r=(a=1); return r.a; } pub fnc main(): int { const Record<T> s=(a=42); return s.a; }'),/E_UNKNOWN_TYPE/);
  assert.throws(()=>compileToIR('pub fnc main(): int { const Record<infer T> r=(a=1); return r.missing; }'),/E_NO_FIELD/);
});

test('lexically captured const Record and explicit Struct scalar projections execute',async()=>{
  for(const expression of ['{:name,:age}','(:name,:age)','{foo:5,:name,:age}','(foo=5,:name,:age)','struct{:name,:age}','(:age,)']){
    assert.equal(await run('const name="Alice"; const age=42; const z='+expression+'; return z.age;'),42n,expression);
  }
  assert.equal(await run('const age=37; const z={foo:5,:age}; return z.foo+z.age;'),42n);
  assert.equal(await run('const age=42; const Record r=(:age); return r.age;'),42n);
  assert.equal(await run('const age=42; const z=(age=age); return z.age;'),42n);
});
test('capture resolves only initialized lexical scalar constants and preserves type boundaries',()=>{
  for(const body of [
    'const z=(:missing); return 0;',
    'const age=42; const z=(:age,age=5); return 0;',
    'const age=42; const z={age:5,:age}; return 0;',
    'const age=42; const z=(:age,5); return 0;',
    'const age=42; const z=(:age.value); return 0;',
    'const age=42; const z=struct{:age}; return z["age"];',
    'const age=42; const z={:age}; return z;',
    'const name="Alice"; const z={:name}; return z.name;',
    'const age=42; const age=5; return age;',
    'const z={:age}; const age=42; return 0;',
    'const age=42; const z=(:age); const w=(:z); return 0;',
  ]) assert.throws(()=>compileToIR('pub fnc main():int{'+body+'}'),undefined,body);
  assert.throws(()=>compileToIR('pub fnc f(int age):int{const z=(:age);return z.age;}'));
  assert.throws(()=>compileToIR('fnc f():int{const age=42;return age;} pub fnc main():int{const z=(:age);return z.age;}'));
});

test('mixed colon and equals scalar Record fields preserve named shapes and execution',async()=>{
  for(const expression of ['{foo=40,bar:2}','(foo:40,bar=2)','{foo=40,bar=2,}','(foo:40,bar:2)']){
    assert.equal(await run('const r='+expression+'; return r.foo+r.bar;'),42n,expression);
  }
  assert.equal(await run('const Record<infer T> r={foo=40,bar:2}; const Record<T> s=(bar:2,foo=40); return s.foo+s.bar;'),42n);
});
test('mixed Record syntax retains duplicate, delimiter, and kind boundaries',()=>{
  for(const body of [
    'const r={foo=1,foo:2}; return 0;',
    'const r=(foo:1,foo=2); return 0;',
    'const r={foo=1\nbar=2}; return 0;',
    'const r=(foo:1,2); return 0;',
    'const struct r={foo=1}; return 0;',
    'const r={foo:1;bar:2}; return 0;',
  ])assert.throws(()=>compileToIR('pub fnc main():int{'+body+'}'),undefined,body);
});
