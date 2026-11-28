import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIR} from '../src/compiler.mjs';
const main = body => 'pub fnc main(): int { '+body+' return 0; }';
test('named aggregate inference cannot capture builtins or reserved names',()=>{
  for(const name of ['DynRecord','Map','Option','Array','Future','String','Integer','void','self','Result','Channel','ActorRef','type','infer']){
    for(const [kind,literal] of [['DynRecord','("a":1)'],['Record','{a:1}'],['Tuple','(1,true)'],['struct','{a:1}']]){
      assert.throws(()=>compileToIR(main(`const ${kind}<infer ${name}> r=${literal};`)),/E_TYPE_NAME/);
    }
  }
});
test('ordinary names remain usable and anonymous inference introduces no type',()=>{
  assert.doesNotThrow(()=>compileToIR(main('const DynRecord<infer T1> r=("a":true,"b":"xyz","c":5); const DynRecord<T1> s=("c":10,"b":"abc","a":false);')));
  assert.throws(()=>compileToIR(main('const DynRecord r=("a":1); const DynRecord<T> s=("a":2);')),/E_UNKNOWN_TYPE/);
});
test('bare infer remains invalid for each aggregate kind',()=>{
  for(const [kind,literal] of [['DynRecord','("a":1)'],['Record','{a:1}'],['Tuple','(1,true)'],['struct','{a:1}']])
    assert.throws(()=>compileToIR(main(`const ${kind}<infer> r=${literal};`)),/identifier/);
});

test('aggregate lowering validates identifiers before erasing them',()=>{
  for(const name of ['while','select','await','throw','Pointer','ActorMail','AtomicInt','ReadLoan','RwLock']){
    assert.throws(()=>compileToIR(main(`const DynRecord<infer ${name}> r=("a":1);`)),/E_TYPE_NAME/);
  }
  for(const body of [
    'const DynRecord<infer R> while=("a":1);',
    'const Record<infer R> r={select:1};',
    'const struct<infer S> s={await:1};'
  ]) assert.throws(()=>compileToIR(main(body)),/E_TYPE_NAME/);
  assert.doesNotThrow(()=>compileToIR(main('const DynRecord<infer If> r=("a":1); const DynRecord<If> s=("a":42);')));
});
