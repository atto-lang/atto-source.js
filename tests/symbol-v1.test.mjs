import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
import {validateProgramIRV2} from '../src/program-ir-v2.mjs';

const load=source=>import('data:text/javascript;charset=utf-8,'+
  encodeURIComponent(compileProgramV2(source)));

test('hash Symbol literals are typed, NFC-normalized and non-interned',async()=>{
  const source=[
    'pub fnc tag():Symbol{return #ready;}',
    'pub fnc quoted():Symbol{return #"cafe\\u0301";}',
    'pub fnc keyword():Symbol{return #class;}',
    "pub fnc single():Symbol{return #'ready foo';}"
  ].join('\n');
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.functions[0].returnType,'symbol');
  assert.deepEqual(ir.functions[0].body,{kind:'symbol',value:'ready'});
  assert.equal(ir.functions[1].body.value,'café');
  const mod=await load(source);
  const a=mod.tag(),b=mod.tag();
  assert.notStrictEqual(a,b,'Oreslang Symbols must not require pointer interning');
  assert.equal(a.kind,'PROCESS');
  assert.equal(a.name,'ready');
  assert.equal(Object.getPrototypeOf(a),null);
  assert.equal(Object.isFrozen(a),true);
  assert.deepEqual(mod.quoted(),Object.assign(Object.create(null),{kind:'PROCESS',name:'café'}));
  assert.equal(mod.keyword().name,'class');
  assert.equal(mod.single().name,'ready foo');
});

test('typed Symbol parameters accept only module-branded values',async()=>{
  const source=[
    'pub fnc tag():Symbol{return #ready;}',
    'pub fnc echo(Symbol value):Symbol{return value;}'
  ].join('\n');
  const mod=await load(source);
  const symbol=mod.tag();
  assert.strictEqual(mod.echo(symbol),symbol);
  const forged=Object.create(null);
  Object.defineProperties(forged,{
    kind:{value:'PROCESS',enumerable:true},
    name:{value:'ready',enumerable:true}
  });
  Object.freeze(forged);
  assert.throws(()=>mod.echo(forged),/Oreslang Symbol required/);
  assert.throws(()=>mod.echo('ready'),/Oreslang Symbol required/);
});

test('Symbol source budgets and strict quoted escapes match Java baseline',()=>{
  const valid=[
    'pub fnc x():Symbol{return #'+ 'a'.repeat(128) +';}',
    'pub fnc x():Symbol{return #"'+ 'é'.repeat(128) +'";}',
    "pub fnc x():Symbol{return #'ready foo';}"
  ];
  for(const source of valid)assert.doesNotThrow(()=>compileProgramV2(source),source);

  const invalid=[
    'pub fnc x():Symbol{return #;}',
    'pub fnc x():Symbol{return # ready;}',
    'pub fnc x():Symbol{return #123;}',
    'pub fnc x():Symbol{return #é;}',
    'pub fnc x():Symbol{return #'+ 'a'.repeat(129) +';}',
    'pub fnc x():Symbol{return #"\\q";}',
    'pub fnc x():Symbol{return #"unterminated;}',
    'pub fnc x():Symbol{return #"\\u202e";}',
    'pub fnc x():Symbol{return #"\\u0000";}',
    'pub fnc x():Symbol{return #"'+ 'a'.repeat(257) +'";}',
    'pub fnc x():Symbol{return #"'+ 'a'.repeat(1025) +'";}'
  ];
  for(const source of invalid)
    assert.throws(()=>compileProgramV2(source),/error: program v2:/,source);
});

test('Symbol remains nominal and cannot be used as int/bool in this slice',()=>{
  for(const source of [
    'pub fnc x():int{return #ready;}',
    'pub fnc x():bool{return #ready;}',
    'pub fnc x():Symbol{return 1;}',
    'pub fnc x():Symbol{return true;}',
    'pub fnc x():bool{return #ready == #ready;}'
  ]) assert.throws(()=>compileProgramV2(source),/error: program (?:v2|IR):/,source);
});

test('direct IR requires canonical NFC and bounded safe Symbol names',()=>{
  const good=compileToProgramIRV2('pub fnc x():Symbol{return #ready;}');
  assert.deepEqual(validateProgramIRV2(JSON.parse(JSON.stringify(good))),good);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(good))),
    compileProgramV2('pub fnc x():Symbol{return #ready;}'));
  for(const name of ['cafe\u0301','\u202e','', 'a'.repeat(257)]){
    const ir=JSON.parse(JSON.stringify(good));
    ir.functions[0].body.value=name;
    assert.throws(()=>compileProgramIRV2(ir),/error: program IR:/,JSON.stringify(name));
  }
});

test('Symbol is reserved as a nominal module namespace',()=>{
  assert.throws(()=>compileProgramV2(
    'define module Symbol as pub fnc x():int{return 1;} end'
  ),/reserved portable intrinsic module name Symbol/);
});
