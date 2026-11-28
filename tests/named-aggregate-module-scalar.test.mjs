import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIR,compileIR} from '../src/compiler.mjs';
const guest=async source=>import('data:text/javascript;base64,'+Buffer.from(compileIR(compileToIR(source))).toString('base64'));
const types='const DynRecord<infer R> exemplar=("a":true,"c":5); const Tuple<infer T> tuple_exemplar=(true,5); ';
test('module aliases and parameter-derived local fields preserve actual inputs',async()=>{
  const m=await guest(types+'pub fnc process(int value):int { const DynRecord<R> actual=("a":false,"c":value); const Tuple<T> t=(true,value); return actual.c+t[1]; } pub fnc main():int{return process(21); }');
  assert.equal(m.main(),42n);
  assert.equal(m.process(7n),14n);
});
test('module value projections and isolated local aliases',async()=>{
  const m=await guest(types+'const DynRecord<R> actual=("c":42,"a":false); pub fnc main():int{return actual.c;}');
  assert.equal(m.main(),42n);
  assert.throws(()=>compileToIR('fnc f():int{const DynRecord<infer R> r=("a":1);return r.a;} pub fnc main():int{const DynRecord<R> r=("a":42);return r.a;}'),/E_UNKNOWN_TYPE/);
});
test('computed field type, reserved names and unsupported ABI reject',()=>{
  for(const body of ['const DynRecord<R> r=("a":false,"c":true);return 0;','const Tuple<T> t=(value,true);return 0;','const DynRecord<R> if=("a":false,"c":value);return 0;','const Record<infer Q> r={while:1};return 0;'])
    assert.throws(()=>compileToIR(types+'pub fnc main(int value):int{'+body+'}'));
  assert.throws(()=>compileToIR('const struct<infer S> s={a:1};pub fnc main():int{return s.a;}'),/E_MODULE_AGGREGATE_INFER_UNSUPPORTED/);
  assert.throws(()=>compileToIR(types+'fnc process(DynRecord<R> input):int{return input.c;}pub fnc main():int{return 0;}'));
});
