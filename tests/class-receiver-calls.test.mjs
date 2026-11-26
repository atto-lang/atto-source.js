import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileProgramV2,compileToProgramIRV2,compileProgramIRV2
} from '../src/program-v2.mjs';
import {validateProgramIRV2} from '../src/program-ir-v2.mjs';

const load=source=>import('data:text/javascript;charset=utf-8,'+
  encodeURIComponent(compileProgramV2(source)));

const source=[
  'fnc calculate(int x):int{return x+100;}',
  'pub define class Box as',
  '  calculate(int x):int{return x+1;}',
  '  double(int x):int{return x*2;}',
  '  pub via_implicit(int x):int{return calculate(x);}',
  '  pub via_explicit(int x):int{return self.calculate(x);}',
  '  pub chained(int x):int{return self.double(calculate(x));}',
  'end',
  'pub fnc demo():int{return new Box().chained(20);}'
].join('\n');

test('self.method and unqualified method bind the same private receiver slot',async()=>{
  const ir=compileToProgramIRV2(source);
  const methods=ir.classes[0].methods;
  assert.equal(methods[2].body.kind,'selfCall');
  assert.equal(methods[3].body.kind,'selfCall');
  assert.equal(methods[2].body.methodIndex,0);
  assert.equal(methods[3].body.methodIndex,0);
  assert.equal(methods[4].body.kind,'selfCall');
  assert.deepEqual(validateProgramIRV2(JSON.parse(JSON.stringify(ir))),ir);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),compileProgramV2(source));
  const mod=await load(source);
  const box=new mod.Box();
  assert.equal(box.via_implicit(41n),42n);
  assert.equal(box.via_explicit(41n),42n);
  assert.equal(box.chained(20n),42n);
  assert.equal(mod.demo(),42n);
  assert.equal(Object.hasOwn(box,'calculate'),false);
  assert.equal(box.calculate,undefined);
  const unbound=box.via_implicit;
  assert.throws(()=>unbound(41n),/invalid Oreslang receiver/);
  assert.throws(()=>box.via_explicit(41),/BigInt/);
});

test('self calls accept named arguments and preserve their lexical evaluation order',async()=>{
  const s=[
    'pub define class Choice as',
    '  pick(int a,int b):int{return a;}',
    '  pub choose():int{return self.pick(b:2,a:40+2);}',
    '  pub choose_implicit():int{return pick(b:2,a:40+2);}',
    '  pub fail_first():int{return self.pick(b:Integer.rem(1, 0),a:9223372036854775807+1);}',
    '  pub overflow_first():int{return pick(a:9223372036854775807+1,b:Integer.rem(1, 0));}',
    'end'
  ].join('\n');
  const ir=compileToProgramIRV2(s);
  assert.equal(ir.classes[0].methods[1].body.kind,'namedSelfCall');
  assert.deepEqual(ir.classes[0].methods[1].body.paramOrder,[1,0]);
  const m=await load(s);
  const choice=new m.Choice();
  assert.equal(choice.choose(),42n);
  assert.equal(choice.choose_implicit(),42n);
  assert.throws(()=>choice.fail_first(),/ORES_I64_DIVISION_BY_ZERO/);
  assert.throws(()=>choice.overflow_first(),/ORES_I64_OVERFLOW/);
});

test('typed bool self calls compile without host truthiness',async()=>{
  const s=[
    'pub define class Gate as',
    '  private_gate(bool enabled):bool{return !enabled;}',
    '  pub check(bool enabled):bool{return self.private_gate(enabled);}',
    'end'
  ].join('\n');
  const m=await load(s);
  assert.equal(new m.Gate().check(true),false);
  assert.equal(new m.Gate().check(false),true);
  assert.throws(()=>new m.Gate().check(1n),/bool required/);
});

test('reject bare self.method, unsupported root escapes, unknown methods and cycles',()=>{
  for(const s of [
    'define class X as pub f():int{return self.f;} end',
    'define class X as pub f():int{return self;} end',
    'define class X as pub f():int{return self.unknown();} end',
    'define class X as pub f():int{return unknown();} end',
    'define class X as pub f():int{return self.f();} end',
    'define class X as pub f():int{return g();} g():int{return f();} end',
    'define class X as nil():void{} pub f():int{return nil();} end',
    'define class X as pub f():int{return pkg::outside();} end',
    'pub fnc outside():int{return self.anything();}'
  ])assert.throws(()=>compileProgramV2(s),/error: program v2:|error: program IR:/,s);
});

test('forged IR cannot cross class scope or manufacture recursion and argument aliases',()=>{
  const initial=compileToProgramIRV2(source);
  const edit=modify=>{
    const value=JSON.parse(JSON.stringify(initial));
    modify(value);
    return value;
  };
  const invalid=[
    edit(ir=>{ir.classes[0].methods[2].body.methodIndex=999;}),
    edit(ir=>{ir.classes[0].methods[2].body.methodIndex=-1;}),
    edit(ir=>{ir.classes[0].methods[2].body.methodIndex=2;}),
    edit(ir=>{ir.classes[0].methods[2].body.args=[];}),
    edit(ir=>{ir.classes[0].methods[2].body.args=[{kind:'bool',value:true}];}),
    edit(ir=>{ir.functions[1].body={kind:'selfCall',methodIndex:0,args:[]};}),
    edit(ir=>{
      const body=ir.classes[0].methods[2].body;
      ir.classes[0].methods[2].body={...body,kind:'namedSelfCall',paramOrder:[1]};
    })
  ];
  for(const ir of invalid)
    assert.throws(()=>compileProgramIRV2(ir),/error: program IR:/);
});

test('canonical instance markers preserve contextual names and receiver dispatch',async()=>{
  for(const name of ['ping','mtd','method']){
    let baseline;
    for(const marker of ['', 'mtd ', 'fnc ']){
      const s='pub define class Box as '+marker+name+
        '(int n):int{return n+1;} pub answer():int{return self.'+name+'(41);} end';
      const ir=compileToProgramIRV2(s);
      const emitted=compileProgramV2(s);
      if(baseline===undefined)baseline={ir,emitted};
      else {
        assert.deepEqual(ir,baseline.ir);
        assert.equal(emitted,baseline.emitted);
      }
      const mod=await load(s);
      assert.equal(new mod.Box().answer(),42n);
      for(const other of ['', 'mtd ', 'fnc ']){
        assert.throws(()=>compileProgramV2('define class Box as '+marker+name+
          '():int{return 1;} '+other+name+'():int{return 2;} end'),
          /duplicate method name\/arity/);
      }
    }
    assert.throws(()=>compileProgramV2('define class Box as method '+name+
      '():int{return 42;} end'),/OBSOLETE_METHOD_INTRODUCER/);
  }
});

test('stacked declaration markers reject before receiver lowering',()=>{
  for(const first of ['mtd','fnc','method']){
    for(const second of ['mtd','fnc','method']){
      for(const trivia of [' ', ' /* marker */ ']){
        const s='define class Box as '+first+trivia+second+
          ' ping():int{return 42;} end';
        assert.throws(()=>compileProgramV2(s),/DUPLICATE_METHOD_INTRODUCER/);
      }
    }
  }
  for(const name of ['ping','mtd','method']){
    const s='define class Box as method '+name+'<T>():int{return 42;} end';
    assert.throws(()=>compileProgramV2(s),/OBSOLETE_METHOD_INTRODUCER/);
  }
});
