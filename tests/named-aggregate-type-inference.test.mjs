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

test('scalar Pair binding forms, mixed Record entries and newline separators execute',async()=>{
  for(const body of [
    'const x := 42; return x.value;',
    'const x = x := 42; return x.value;',
    'const r={foo := 40\nbar = 2,}; return r.foo+r.bar;',
    'const r={foo := 40\nbar := 2}; return r.foo+r.bar;',
    'const r=(foo := 40,bar = 2); return r.foo+r.bar;',
    'const r=(foo : 40,bar := 2); return r.foo+r.bar;',
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
    'const r=(foo := 1); return 0;',
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


test('contextual empty local products preserve exact kind and zero shape',async()=>{
  for(const body of [
    'const t=(); return 42;',
    'const Tuple t=(); const Record r=(); const Record s={}; return 42;',
    'const Record<infer R> r=(); const Record<R> s={}; return 42;',
    'const Tuple<infer T> t=(); const Tuple<T> u=(); return 42;',
    'const Record r=(); const s={...r,a:42}; return s.a;',
    'const Record r=(); const s=r with {a:42}; return s.a;'
  ])assert.equal(await run(body),42n,body);
});
test('empty product kind and exact shape cannot be silently changed',()=>{
  for(const [body,error] of [
    ['const Record<infer R> r=(); const Tuple<R> t=(); return 0;',/E_AGGREGATE_KIND/],
    ['const Tuple<infer T> t=(); const Record<T> r=(); return 0;',/E_AGGREGATE_KIND/],
    ['const Record<infer R> r={a:1}; const Record<R> s=(); return 0;',/E_TYPE_MISMATCH/],
    ['const Record<infer R> r=(); const Record<R> s={a:1}; return 0;',/E_TYPE_MISMATCH/],
    ['const Tuple<infer T> t=(1,2); const Tuple<T> u=(); return 0;',/E_TYPE_MISMATCH/],
    ['const t=(); const r={...t,a:42}; return r.a;',/E_RECORD_SPREAD/],
    ['const t=(); return t[0];',/E_NO_FIELD/],
    ['const Record r=(); return r.a;',/E_NO_FIELD/],
    ['const Record r=(); return r[0];',/expected/],
    ['const t=(); return t.a;',/expected/],
    ['const r={}; return 0;',/E_LITERAL_KIND/],
    ['const struct s={}; return 0;',/E_LITERAL_KIND/],
    ['const t=(); const Record r=t; return 0;',/expected/]
  ])assert.throws(()=>compileToIR('pub fnc main():int{'+body+'}'),error,body);
});

test('explicit Tuple context admits either singleton spelling',async()=>{
  assert.equal(await run('const Tuple t=(42,); return t[0];'),42n);
  assert.equal(await run('const Tuple t=(42); return t[0];'),42n);
  assert.equal(await run('const Tuple<infer T> t=(1); const Tuple<T> u=(42,); return u[0];'),42n);
  assert.throws(()=>compileToIR('pub fnc main():int{const Tuple<infer T> t=(1,2);const Tuple<T> u=(42);return 0;}'),/E_TYPE_MISMATCH/);
});

test('untyped grouped scalar remains scalar and is not implicitly wrapped',async()=>{
  assert.equal(await run('const x=(42); return x;'),42n);
  assert.equal(await run('const x=(-42); return 0-x;'),42n);
  assert.equal(await run('const x=42; const y=(x); return y;'),42n);
  assert.throws(()=>compileToIR('pub fnc main():int{const x=(42);return x[0];}'));
  assert.throws(()=>compileToIR('pub fnc main():int{const x=(42);const Tuple t=x;return 0;}'));
});


test('closed named Tuple conversion selects exact payloads and retains Pair projection',async()=>{
  for(const body of [
    'const t=Tuple.of(five := 40,three := 2); const r=t.to_record(); return r.five+r.three;',
    'const Tuple t=Tuple.of(five := 40,three := 2,five := true); const Record r=t.to_record(duplicates: #first); return r.five+r.three;',
    'const t=Tuple.of(five := true,three := 2,five := 40); const r=t.to_record(duplicates=#last); return r.five+r.three;',
    'const t=Tuple.of(five := 40,three := 2,five := "discard"); const r=t.to_record(duplicates=#first); return r.five+r.three;',
    'const t=Tuple.of(five := "discard",three := 2,five := 40); const r=t.to_record(duplicates: #last); return r.five+r.three;',
    'const r=Record.of(five := 40,three := 2); const t=r.to_tuple(); return t[0].value+t[1].value;',
    'const r=Record.of(five := 40,three := 2); const Tuple t=r.to_tuple(); const Record s=t.to_record(duplicates: #reject); return s.five+s.three;',
    'const t=Tuple.of(five := 40,five := 2); return t[0].value+t[1].value;',
    'const r=Record.of(); const t=r.to_tuple(); const s=t.to_record(); return 42;',
    'const r=Record.of(z := 42,a := 0); const t=r.to_tuple(); return t[0].value;'
  ])assert.equal(await run(body),42n,body);
});
test('closed conversion rejects unsupported values, ambiguous keys, and kind mismatches',()=>{
  for(const [body,error] of [
    ['const t=Tuple.of(a := 1,a := 2); const r=t.to_record(); return 0;',/E_DUPLICATE_FIELD/],
    ['const r=Record.of(a := 1,a := 2); return 0;',/E_DUPLICATE_FIELD/],
    ['const t=Tuple.of(a := 1,a := 2); const r=t.to_record(duplicates: #reject); return 0;',/E_DUPLICATE_FIELD/],
    ['const t=Tuple.of(a := 1); const r=t.to_record(duplicates:=#first); return 0;',/expected =/],
    ['const t=Tuple.of(a := 1); const r=t.to_record(duplicates: true); return 0;',/E_DUPLICATE_POLICY/],
    ['const Tuple t=(1,2); const r=t.to_record(); return 0;',/E_RECORD_KEY/],
    ['const t=Tuple.of(a := 1); return t[0];',/expected \./],
    ['const r=Record.of(a := 1); const Record t=r.to_tuple(); return 0;',/E_AGGREGATE_KIND/],
    ['const r=Record.of(a := 1); const s=r.to_record(); return 0;',/expected Tuple/],
    ['const t=Tuple.of(a := 1); const s=t.to_tuple(); return 0;',/closed constexpr Record/],
    ['const t=Tuple.of(a := 1+2); return 0;',/expected \)/],
    ['const Tuple=1; const t=Tuple.of(a := 1); return 0;',/E_PRODUCT_SHADOW/]
  ])assert.throws(()=>compileToIR('pub fnc main():int{'+body+'}'),error,body);
  assert.throws(()=>compileToIR('pub fnc main(int x):int{const t=Tuple.of(a := x); return 0;}'),/E_TYPE_INFER_AMBIGUOUS/);
  assert.throws(()=>compileToIR('pub fnc main(int Tuple):int{const t=Tuple.of(a := 1); return 0;}'),/E_PRODUCT_SHADOW/);
  assert.throws(()=>compileToIR('pub fnc main():int{const t=Tuple.of(a := 1); return 0;} fnc Tuple():int{return 1;}'),/E_PRODUCT_SHADOW/);
});
