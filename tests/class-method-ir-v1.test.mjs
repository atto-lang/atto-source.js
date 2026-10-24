import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASS_METHOD_IR_VERSION, CLASS_METHOD_IR_DIALECT, CLASS_METHOD_IR_INT_MODEL,
  ClassMethodIRError, validateClassMethodIRV1, stringifyClassMethodIRV1
} from '../src/class-method-ir-v1.mjs';
import {
  compileToClassMethodIRV1, compileClassMethodIRV1, compileClassMethodsV1
} from '../src/class-methods-v1.mjs';

const valid=()=>({
  schemaVersion:CLASS_METHOD_IR_VERSION,
  dialect:CLASS_METHOD_IR_DIALECT,
  integerModel:CLASS_METHOD_IR_INT_MODEL,
  classes:[{
    name:'Box',pub:true,methods:[
      {name:'read',pub:true,paramTypes:['int'],resultType:'int',
        body:{kind:'arg',index:0}},
      {name:'zero',pub:true,paramTypes:[],resultType:'void',
        body:{kind:'void'}}
    ]
  }]
});

test('source lowering produces strict JSON-safe class-method IR and round-trips',()=>{
  const source=`pub define class Box as
    pub mtd read(self,int value) -> int :: return value; end
    pub zero() -> void :: end
  end`;
  const ir=compileToClassMethodIRV1(source);
  assert.deepEqual(ir,valid());
  assert.deepEqual(JSON.parse(stringifyClassMethodIRV1(ir)),ir);
  assert.equal(compileClassMethodIRV1(JSON.parse(JSON.stringify(ir))),
    compileClassMethodsV1(source));
});

test('implicit and explicit self normalize to identical resolved method IR',()=>{
  const implicit=compileToClassMethodIRV1('pub define class X as pub foo(int x):int{return x;} end');
  const explicit=compileToClassMethodIRV1('pub define class X as pub foo(self,int x):int{return x;} end');
  assert.deepEqual(implicit,explicit);
  assert.equal(Object.hasOwn(implicit.classes[0].methods[0],'receiver'),false);
});

test('IR validator defensively copies nested records and arrays',()=>{
  const input=valid();
  const checked=validateClassMethodIRV1(input);
  input.classes[0].name='Mutated';
  input.classes[0].methods[0].paramTypes[0]='void';
  input.classes[0].methods[0].body.index=99;
  assert.equal(checked.classes[0].name,'Box');
  assert.deepEqual(checked.classes[0].methods[0].paramTypes,['int']);
  assert.deepEqual(checked.classes[0].methods[0].body,{kind:'arg',index:0});
});

test('IR rejects duplicate receiver-erased selectors and invalid body typing',()=>{
  const duplicate=valid();
  duplicate.classes[0].methods.push(
    {name:'read',pub:false,paramTypes:['int'],resultType:'int',
      body:{kind:'literal',value:'1'}}
  );
  assert.throws(()=>validateClassMethodIRV1(duplicate),
    /duplicate caller-visible method arity read\/1/);

  for(const mutate of [
    ir=>{ir.classes[0].methods[0].body={kind:'arg',index:1};},
    ir=>{ir.classes[0].methods[0].resultType='void';},
    ir=>{ir.classes[0].methods[1].body={kind:'literal',value:'1'};},
    ir=>{ir.classes[0].methods[0].paramTypes=['bool'];},
    ir=>{ir.classes[0].methods[0].body={kind:'literal',value:'9223372036854775808'};}
  ]){
    const ir=valid();mutate(ir);
    assert.throws(()=>validateClassMethodIRV1(ir),ClassMethodIRError);
  }
});

test('IR rejects reserved identifiers, extra fields, accessors and exotic records',()=>{
  for(const mutate of [
    ir=>{ir.classes[0].name='class';},
    ir=>{ir.classes[0].methods[0].name='return';},
    ir=>{ir.extra=true;},
    ir=>{ir.classes[0].methods[0].extra=true;},
    ir=>{ir.classes[0].methods[0].receiver=true;},
    ir=>{Object.setPrototypeOf(ir.classes[0],new Date());}
  ]){
    const ir=valid();mutate(ir);
    assert.throws(()=>validateClassMethodIRV1(ir),ClassMethodIRError);
  }

  const accessor=valid();
  Object.defineProperty(accessor.classes[0].methods[0].body,'index',{get(){return 0;}});
  assert.throws(()=>validateClassMethodIRV1(accessor),/accessor/);
});

test('IR rejects sparse and decorated arrays',()=>{
  const sparse=valid();
  sparse.classes.length=2;
  assert.throws(()=>validateClassMethodIRV1(sparse),ClassMethodIRError);

  const decorated=valid();
  decorated.classes[0].methods.note='x';
  assert.throws(()=>validateClassMethodIRV1(decorated),ClassMethodIRError);
});

test('direct IR compilation preserves signed bounds and runtime arity checks',async()=>{
  const ir=valid();
  ir.classes[0].methods.unshift(
    {name:'min',pub:true,paramTypes:[],resultType:'int',
      body:{kind:'literal',value:'-9223372036854775808'}},
    {name:'max',pub:true,paramTypes:[],resultType:'int',
      body:{kind:'literal',value:'9223372036854775807'}}
  );
  const esm=compileClassMethodIRV1(ir);
  const ns=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
  const box=new ns.Box();
  assert.equal(box.min(),-(1n<<63n));
  assert.equal(box.max(),(1n<<63n)-1n);
  assert.equal(box.read(7n),7n);
  assert.throws(()=>box.read(),/method arity mismatch/);
  assert.throws(()=>box.read(7),/signed i64 BigInt/);
});
