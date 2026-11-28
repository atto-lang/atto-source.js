import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIR,compileIR} from '../src/compiler.mjs';
const source=body=>'pub fnc main(int n): int { '+body+' }';
const run=async body=>{
  const ir=compileToIR(source(body));
  const js=compileIR(ir);
  const mod=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  return mod.main(40n);
};
test('nested immutable Record array projections compile and execute generated scalar JS',async()=>{
  for(const body of [
    'const Record r={x:[1,2,39]};return r.x[0]+r.x[1]+r.x[2];',
    'const Record r={x:[{a:1},{b:2},{c:39}]};return r.x[0].a+r.x[1].b+r.x[2].c;',
    'const Record r=("x":[{a:n},("b":2),{c:3}]);return r["x"][0].a+r.x[1]["b"];',
    'const Record r={x:{y:[n,2]}};return r.x.y[0]+r.x.y[1];',
    'const Record<infer T> r={x:[{a:1},{b:2}]};const Record<T> s=("x":[("b":n),{a:2}]);return s.x[0].b+s.x[1].a;'
  ])assert.equal(await run(body),42n,body);
});
test('recursive projections fail before artifact for missing fields, bounds, unproven indexes and shape mismatch',()=>{
  for(const [body,diagnostic] of [
    ['const Record r={x:[{a:1},{b:2}]};return r.x[1].a;',/E_NO_FIELD/],
    ['const Record r={x:[1,2,3]};return r.x[3];',/E_BOUNDS/],
    ['const Record r={x:[1,2,3]};return r.x[n];',/static index/],
    ['const Record r={x:[1,true]};return 0;',/E_TYPE_MISMATCH/],
    ['const Record r={x:[]};return 0;',/E_TYPE_INFER_AMBIGUOUS/],
    ['const Record r={x:[("a":1,b:2)]};return 0;',/E_RECORD_LABEL/],
    ['const Record r={x:[{a:1,a:2}]};return 0;',/E_DUPLICATE_FIELD/],
    ['const Record<infer T> r={x:[1]};const Record<T> s={x:[true]};return 0;',/E_TYPE_MISMATCH/],
    ['const Record r={x:[n]};const v={...r};return 0;',/E_RECORD_SPREAD/],
    ['const Record r={x:[1,2,3]};return r.x;',/static|expected/],
    ['const Record r={x:'+ '['.repeat(40)+'1'+']'.repeat(40)+'};return 0;',/nesting limit/]
  ])assert.throws(()=>compileToIR(source(body)),diagnostic,body);
});

test('deep admitted Record array shapes do not amplify descriptor encoding',async()=>{
  const open='['.repeat(28),close=']'.repeat(28);
  assert.equal(await run('const Record r={x:'+open+'42'+close+'};return r.x'+'[0]'.repeat(28)+';'),42n);
});
