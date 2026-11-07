import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileProgramV2,
  compileProgramIRV2,
  compileToProgramIRV2
} from '../src/program-v2.mjs';

async function load(source) {
  const esm=compileProgramV2(source);
  return import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
}

test('program-v2 sync gen* is lazy and yields typed signed-i64 values',async()=>{
  const ns=await load([
    'pub gen* values(int n): Iterator<int> {',
    '  yield n;',
    '  yield n+1;',
    '  return;',
    '}',
    'pub fnc main(): int {return 0;}'
  ].join('\n'));

  const iterator=ns.values(41n);
  const first=iterator.next();
  assert.deepEqual(first,{value:41n,done:false});
  assert.equal(Object.isFrozen(first),true);
  const second=iterator.next();
  assert.deepEqual(second,{value:42n,done:false});
  assert.equal(Object.isFrozen(second),true);
  const done=iterator.next();
  assert.equal(done.done,true);
  assert.equal(Object.isFrozen(done),true);
  assert.equal(iterator.next().done,true);

  // Generator yields remain lazy, but the callable boundary is typed:
  // wrong or out-of-range inputs must fail before an iterator exists.
  for(const bad of [41,null,undefined,true,{},'41'])
    assert.throws(()=>ns.values(bad),/Oreslang signed i64 BigInt required/);
  for(const bad of [1n<<63n,-(1n<<63n)-1n])
    assert.throws(()=>ns.values(bad),/ORES_I64_OVERFLOW/);
  // Closing without ever pulling must not evaluate the body.
  const unpulled=ns.values(41n);
  unpulled.close();
  assert.deepEqual(unpulled.next(),{value:undefined,done:true});
});

test('close is idempotent, terminal is sticky, and host generator controls are sealed',async()=>{
  const ns=await load('pub gen* values(): Iterator<int> {yield 1;yield 2;return;}');
  const iterator=ns.values();
  assert.throws(()=>iterator.next(1n),/Iterator\.next takes no arguments/);
  assert.throws(()=>iterator.close(1n),/Iterator\.close takes no arguments/);
  assert.deepEqual(iterator.next(),{value:1n,done:false});
  assert.equal(typeof iterator.return,'undefined');
  assert.equal(typeof iterator.throw,'undefined');
  assert.equal(Object.isFrozen(iterator),true);
  assert.equal(Object.getPrototypeOf(iterator),null);
  assert.equal(iterator[Symbol.iterator](),iterator);
  iterator.close();
  iterator.close();
  assert.deepEqual(iterator.next(),{value:undefined,done:true});
  assert.deepEqual(iterator.next(),{value:undefined,done:true});
});

test('generator and function overloads share a name only when value arity differs',async()=>{
  const source=[
    'pub gen* values(): Iterator<int> {yield 7;return;}',
    'pub fnc values(int n): int {return n+1;}'
  ].join('\n');
  const ns=await load(source);

  const iterator=ns.values();
  assert.deepEqual(iterator.next(),{value:7n,done:false});
  assert.deepEqual(iterator.next(),{value:undefined,done:true});
  assert.equal(ns.values(41n),42n);
  assert.throws(()=>ns.values(1n,2n),/Oreslang overload arity mismatch/);

  const ir=compileToProgramIRV2(source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),compileProgramV2(source));

  assert.throws(
    ()=>compileProgramV2(
      'pub gen* values(): Iterator<int> {yield 1;return;} pub fnc values(): int {return 0;}'),
    /duplicate caller-visible arity/);
});

test('module generator exports are frozen and private generators do not leak',async()=>{
  const ns=await load([
    'define module source as',
    '  gen* hidden(): Iterator<int> {yield 9;return;}',
    '  pub gen* visible(): Iterator<int> {yield 42;return;}',
    'end'
  ].join('\n'));
  assert.deepEqual(Object.keys(ns),['source']);
  assert.deepEqual(Object.keys(ns.source),['visible']);
  assert.ok(Object.isFrozen(ns.source));
  assert.equal(Object.getPrototypeOf(ns.source),null);
  assert.deepEqual(ns.source.visible().next(),{value:42n,done:false});
  assert.equal(Object.hasOwn(ns.source,'hidden'),false);
});

test('generator IR is explicit, JSON-safe and independently revalidated',()=>{
  const source='pub gen* values(int n): Iterator<int> {yield n;yield n+1;return;}';
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.schemaVersion,2);
  assert.equal(ir.generators.length,1);
  assert.deepEqual(ir.generators[0].paramTypes,['int']);
  assert.equal(ir.generators[0].elementType,'int');
  assert.equal(ir.generators[0].yields.length,2);
  const roundTrip=JSON.parse(JSON.stringify(ir));
  assert.equal(compileProgramIRV2(roundTrip),compileProgramV2(source));

  const forged={...roundTrip,generators:[{...roundTrip.generators[0],elementType:'bool'}]};
  assert.throws(()=>compileProgramIRV2(forged),/error: program IR:/);
  const extra={...roundTrip,generators:[{...roundTrip.generators[0],hostGlobal:'process'}]};
  assert.throws(()=>compileProgramIRV2(extra),/error: program IR:/);
  const reservedName={...roundTrip,generators:[{...roundTrip.generators[0],name:'if'}]};
  assert.throws(()=>compileProgramIRV2(reservedName),/reserved generator identifier/);
  const reservedParam={...roundTrip,generators:[{...roundTrip.generators[0],params:['return']}]};
  assert.throws(()=>compileProgramIRV2(reservedParam),/reserved generator identifier/);

  const mixed=compileToProgramIRV2(
    'fnc f(): int {return 0;} gen* g(): Iterator<int> {yield 1;return;}');
  const oversized={
    ...mixed,
    functions:Array.from({length:512},(_,i)=>({...mixed.functions[0],name:'f'+i})),
    generators:[{...mixed.generators[0],name:'g'}]
  };
  assert.throws(
    ()=>compileProgramIRV2(oversized),
    /caller-visible function\/generator declaration budget exceeded/);
});

test('generator names reject the full native reserved-name parity set',()=>{
  const reserved=[
    'define','class','enum','pattern','module','contract','conforms','namespace',
    'gpu','cpu','quantum','over','structural','bool','pure','Some','None','Ok','Err',
    'using','requires','serial'
  ];
  for(const name of reserved) {
    assert.throws(
      ()=>compileProgramV2(`gen* ${name}(): Iterator<int> {yield 1;return;}`),
      // Execution-domain words fail earlier, at source admission.
      ['gpu','cpu','quantum'].includes(name)
        ? /execution domain '/
        : /reserved generator identifier/,
      name);
    const ir=compileToProgramIRV2('gen* values(): Iterator<int> {yield 1;return;}');
    ir.generators[0].name=name;
    assert.throws(()=>compileProgramIRV2(ir),/reserved generator identifier/,name+' IR');
  }
});

test('unsupported generator semantics fail closed instead of parser-only parity',()=>{
  for(const source of [
    'async gen* values(): AsyncIterator<int> {yield 1;return;}',
    'suspend gen* values(): AsyncIterator<int> {yield 1;return;}',
    'gen* values(): Iterator<int> {yield* other;return;}',
    'gen* values(): Iterator<int> {return 1;}',
    'gen* values(): Iterator<bool> {yield true;return;}',
    'pub fnc use(): int {return values();} gen* values(): Iterator<int> {yield 1;return;}',
    'gen* if(): Iterator<int> {yield 1;return;}',
    'gen* values(int return): Iterator<int> {yield return;return;}'
  ]) assert.throws(()=>compileProgramV2(source),/error: program v2:/,source);
});
