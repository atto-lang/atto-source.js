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
