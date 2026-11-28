import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIR,compileIR} from '../src/compiler.mjs';
const source=body=>'pub fnc main(): int { '+body+' }';
const run=async body=>{
  const js=compileIR(compileToIR(source(body)));
  return (await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))).main();
};
test('literal Record arrays and heterogeneous record arrays project actual i64 guests',async()=>{
  for(const body of [
    'const Record r={x:[1,2,39]}; return r.x[0]+r.x[1]+r.x[2];',
    'const Record r=("x":[1,2,39]); return r["x"][0]+r.x[1]+r.x[2];',
    'const Record r={x:[{a:1},{b:2},{c:39}]}; return r.x[0].a+r.x[1].b+r.x[2].c;',
    'const Record r=("x":[{a:1},("b":2),{c:39}]); return r.x[0].a+r.x[1]["b"]+r.x[2].c;',
    'const Record r={x:{y:[{z:42}]}}; return r.x.y[0].z;',
    'const Record r={x:[("content-type":42)]}; return r.x[0]["content-type"];',
    'const Record<infer T> r={x:[{a:1},{b:2}]}; const Record<T> s=("x":[("b":42),{a:1}]); return s.x[0].b;'
  ]) assert.equal(await run(body),42n,body);
});
test('recursive Record/Array boundaries reject before IR creation',()=>{
  for(const [body,diagnostic] of [
    ['const Record r={x:[1,2]}; return r.x[2];',/E_ARRAY_BOUNDS/],
    ['const Record r={x:[1,2]}; return r.x[99999999999999999999999999999];',/E_ARRAY_BOUNDS/],
    ['const Record r={x:[1,2]}; return r.x[-1];',/E_ARRAY_INDEX/],
    ['const i=0; const Record r={x:[1,2]}; return r.x[i];',/E_ARRAY_INDEX/],
    ['const Record r={x:[{a:1},{b:2}]}; return r.x[1].a;',/E_NO_FIELD/],
    ['const Record r={x:[{a:1},{b:2}]}; return r.x[0]["b"];',/E_NO_FIELD/],
    ['const Record r={x:[1,true]}; return 0;',/E_TYPE_MISMATCH/],
    ['const Record r={x:[]}; return 0;',/E_TYPE_INFER_AMBIGUOUS/],
    ['const Record r={x:[{"a":1}]}; return 0;',/expected identifier/],
    ['const Record r={x:[(a:1)]}; return 0;',/E_TYPE_INFER_AMBIGUOUS/],
    ['const Record r={x:[("a":1,"a":2)]}; return 0;',/E_DUPLICATE_FIELD/],
    ['const Record r={x:[1]}; return r.x;',/only int projections/],
    ['const Record r={x:[1]}; return r.x[0][0];',/E_TYPE_MISMATCH/],
    ['const Record<infer T> r={x:[{a:1}]}; const Record<T> s={x:[{b:2}]}; return 0;',/E_TYPE_MISMATCH/],
    ['const Record r={x:['+'1,'.repeat(64)+'2]}; return 0;',/E_SOURCE_LIMIT/],
    ['const Record r={x:'+'{a:'.repeat(40)+'1'+'}'.repeat(40)+'}; return 0;',/E_SOURCE_LIMIT/]
  ]) assert.throws(()=>compileToIR(source(body)),diagnostic,body);
});
