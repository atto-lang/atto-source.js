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
    ['const Tuple<infer T> r=(1,true); const Tuple<T> s=(1,);',/E_TYPE_MISMATCH/],
    ['const Tuple<infer T> r=(1,true); const Tuple<T> s=(1);',/E_TUPLE_ARITY/],
    ['const struct<infer T> r={a:1}; const Record<T> s=(a=1);',/E_AGGREGATE_KIND/],
    ['const Record<infer T> r=(a=unknown);',/E_TYPE_INFER_AMBIGUOUS/],
  ])assert.throws(()=>compileToIR('pub fnc main(): int { '+body+' return 0; }'),error);
  assert.throws(()=>compileToIR('fnc other(): int { const Record<infer T> r=(a=1); return r.a; } pub fnc main(): int { const Record<T> s=(a=42); return s.a; }'),/E_UNKNOWN_TYPE/);
  assert.throws(()=>compileToIR('pub fnc main(): int { const Record<infer T> r=(a=1); return r.missing; }'),/E_NO_FIELD/);
});

test('lexically captured const Record and explicit Struct scalar projections execute',async()=>{
  for(const expression of ['{:name,:age}','(:name,:age)','{foo:5,:name,:age}','(foo:5,:name,:age)','struct{:name,:age}','(:age,)']){
    assert.equal(await run('const name="Alice"; const age=42; const z='+expression+'; return z.age;'),42n,expression);
  }
  assert.equal(await run('const age=37; const z={foo:5,:age}; return z.foo+z.age;'),42n);
  assert.equal(await run('const age=42; const Record r=(:age); return r.age;'),42n);
  assert.equal(await run('const age=42; const z=(age:age); return z.age;'),42n);
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
  for(const expression of ['{foo=40,bar:2}','{foo=40,bar=2,}','(foo:40,bar:2)']){
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

test('scalar Pair binding forms, mixed Record entries and newline separators execute',async()=>{
  for(const body of [
    'const x := 42; return x.value;',
    'const x = x := 42; return x.value;',
    'const r={foo := 40\nbar = 2,}; return r.foo+r.bar;',
    'const r={foo := 40\nbar := 2}; return r.foo+r.bar;',
    'const Record r=(foo := 40,bar = 2); return r.foo+r.bar;',
    'const Record r=(foo : 40,bar := 2); return r.foo+r.bar;',
    'const foo=7; const r={foo := 40,bar:2}; return r.foo+r.bar+foo-7;',
  ])assert.equal(await run(body),42n,body);
});
test('scalar Record with, spread, and inferred lexical aliases execute',async()=>{
  for(const body of [
    'const r={foo:40}; const v=r with {bar:true,foo:42}; return r.foo+v.foo-40;',
    'const r={foo:40}; const v={...r,bar:2}; return v.foo+v.bar;',
    'const r={foo:40}; const Record<T> v=infer {...r,bar:2}; const Record<T> w=(bar:2,foo:40); return w.foo+v.bar;',
    'const r={foo:40}; const Record<infer T> v={...r,bar:2}; const Record<T> w=r with {bar:2}; return w.foo+v.bar;',
    'const r={foo:40}; const s={foo:1}; const v={...r,...s,foo:42}; return v.foo;',
    'const r={foo:true}; const v=r with {foo:42}; return v.foo;',
  ])assert.equal(await run(body),42n,body);
});
test('bounded Pair/Record grammar rejects malformed, ambiguous and unsafe forms',()=>{
  for(const body of [
    'const r={foo := 1 bar := 2}; return 0;',
    'const r={foo = 1\nbar := 2}; return 0;',
    'const r={foo : 1\nbar := 2}; return 0;',
    'const r={foo := 1,foo:2}; return 0;',
    'const r={foo : = 1}; return 0;',
    'const r=(foo := 1,bar := 2); return 0;',
    'const r=(foo := 1,); return 0;',
    'const r=(foo := 1\nbar = 2); return 0;',
    'const x := 1; const x = x := 2; return 0;',
    'const x := y := 1; return 0;',
    'const x := 42; return x;',
    'const x := 42; const r={...x}; return 0;',
    'const r={foo:1}; const s={foo:2}; const v={...r,...s}; return 0;',
    'const r={foo:1}; const v={foo:2,...r}; return 0;',
    'const r={foo:1}; const v=r with {foo:2,foo:=3}; return 0;',
    'const Record<T> v=infer {...v,foo:1}; return 0;',
    'const T=1; const Record<T> v=infer {foo:1}; return 0;',
    'const Record<T> v={foo:1}; return 0;',
    'const Record<infer T> v={foo:1}; const Record<T> w=infer {foo:true}; return 0;',
    'const struct r={foo:=1}; return 0;',
  ])assert.throws(()=>compileToIR('pub fnc main():int{'+body+'}'),undefined,body);
  assert.throws(()=>compileToIR('pub fnc main(int a):int{const Record r=(x=a); const v={...r}; return v.x;}'),/E_RECORD_SPREAD/);
});


test('stored Pair<int> three spellings, literal keys and typed aliases lower identically',async()=>{
  const spellings=['const x := 42;','const x = x := 42;','const x = Pair.of("x", 42);',
    'const x = "x" := 42;','const x = Pair.of<int>("x", 42);'];
  const generated=[];
  for(const declaration of spellings){
    const body=declaration+' const Pair<int> p=x; return p.value;';
    assert.equal(await run(body),42n);
    generated.push(compileIR(compileToIR('pub fnc main(): int { '+body+' }')));
  }
  assert.equal(new Set(generated).size,1,'same nominal scalar lowering for all spellings');
  assert.equal(await run('const y=7; const x=y:=42; return x.value+y-7;'),42n);
});
test('Pair aliases cannot confer scalar, Record or mutation authority',()=>{
  for(const body of [
    'const x=42; const Pair<int> p=x; return 0;',
    'const x={value:42}; const Pair<int> p=x; return 0;',
    'const x:=true; const Pair<int> p=x; return 0;',
    'const x:=missing; return 0;',
    'const x=x:=x; return 0;',
    'const x:=42; const Pair<int> p=x; return p;',
    'const x:=42; const Pair<int> p=x; p.value=3; return p.value;',
    'const x=Pair.of(7,42); return x.value;',
    'const x=Pair.of("x",42); const x:=3; return x.value;',
    'const Pair=42; const x=Pair.of("x",42); return x.value;',
  ])assert.throws(()=>compileToIR('pub fnc main():int{'+body+'}'),undefined,body);
});

test('revised declaration-local product grammar preserves supported scalar values',async()=>{
  for(const body of [
    'const r=(five:40,six:2); return r.five+r.six;',
    'const Record r=(five:=40,six:=2); return r.five+r.six;',
    'const Record r=(five=40,six:2); return r.five+r.six;',
    'const r={"five":40,"six":2}; return r.five+r.six;',
    'const r={five:=40,six=2}; return r.five+r.six;',
    'const p=(a:=42); return p.value;',
    'const p=("a":=42); return p.value;',
    'const t=(40,2); return t[0]+t[1];',
    'const t=(42,); return t[0];',
    'const empty=(); const Record r=(); const Record s={}; return 42;',
  ])assert.equal(await run(body),42n,body);
});
test('revised syntax rejects invalid shapes and separately fences unsupported recursive products',()=>{
  for(const [body,error] of [
    ['const r={}; return 0;',/E_EMPTY_AGGREGATE/],
    ['const r=(a=1); return 0;',/E_RECORD_CONTEXT/],
    ['const r=(a:1,b=2); return 0;',/E_LITERAL_KIND/],
    ['const r=(a:1,b:=2); return 0;',/E_LITERAL_KIND/],
    ['const r={"a":1,a:=2}; return 0;',/E_DUPLICATE_FIELD/],
    ['const r={"a-b":1}; return 0;',/E_RECORD_LABEL/],
    ['const r=(a:=1,b:=2); return 0;',/E_PAIR_TUPLE_UNSUPPORTED/],
    ['const r=(a:=1,); return 0;',/E_PAIR_TUPLE_UNSUPPORTED/],
  ])assert.throws(()=>compileToIR('pub fnc main():int{'+body+'}'),error,body);
});
