import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {compileProgramV2} from '../src/program-v2.mjs';

// Source-free deterministic mutation operators are applied ONLY to compiler
// output in this trusted test harness. Mutants are never shipped or published.
// A detector passes only if the known-wrong but syntactically valid ESM is
// observed to violate an explicit semantic invariant.
function changeExactlyOnce(esm,before,after){
  const at=esm.indexOf(before);
  assert.notEqual(at,-1,'emitted output lacks mutation anchor '+before);
  assert.equal(esm.indexOf(before,at+before.length),-1,'mutation anchor is ambiguous');
  const changed=esm.slice(0,at)+after+esm.slice(at+before.length);
  assert.notEqual(changed,esm);
  return changed;
}
async function load(esm,id){
  const check=spawnSync(process.execPath,['--input-type=module','--check'],{
    input:esm,encoding:'utf8',timeout:10000,maxBuffer:1024*1024
  });
  assert.equal(check.error,undefined,id+' syntax-check spawn');
  assert.equal(check.status,0,id+' syntax check: '+check.stderr);
  return import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(esm)+'#'+encodeURIComponent(id));
}

for(let i=1;i<=20;i++){
  test('literal output corruption is detected / '+i,async()=>{
    const source='pub fnc main():int{return '+i+'+42-'+i+';}';
    const real=compileProgramV2(source);
    const wrong=changeExactlyOnce(real,'42n','43n');
    const good=await load(real,'literal-good-'+i);
    const bad=await load(wrong,'literal-bad-'+i);
    assert.equal(good.main(),42n);
    assert.notEqual(bad.main(),42n);
    assert.equal(bad.main(),43n);
  });
}

test('mutation: dropping emitted signed-i64 function parameter validation is observable',async()=>{
  const esm=compileProgramV2('pub fnc identity(int v):int{return v;}');
  const wrong=changeExactlyOnce(esm,'_check(_p0);','');
  const good=await load(esm,'arg-good'),bad=await load(wrong,'arg-bad');
  assert.throws(()=>good.identity(42),/BigInt required/);
  assert.equal(bad.identity(42),42);
});

test('mutation: dropping emitted bool parameter validation is observable',async()=>{
  const esm=compileProgramV2('pub fnc choose(bool b):int{return b ? 42 : 0;}');
  const wrong=changeExactlyOnce(esm,'if(typeof v!=="boolean")','if(false)');
  const good=await load(esm,'bool-good'),bad=await load(wrong,'bool-bad');
  assert.throws(()=>good.choose(0n),/bool required/);
  assert.equal(bad.choose(0n),0n);
});

test('mutation: removing intermediate overflow classification is observable',async()=>{
  const esm=compileProgramV2('pub fnc next(int n):int{return n+1;}');
  const wrong=changeExactlyOnce(esm,'if(v<-(1n<<63n)||v>(1n<<63n)-1n)','if(false)');
  const good=await load(esm,'overflow-good'),bad=await load(wrong,'overflow-bad');
  const max=(1n<<63n)-1n;
  assert.throws(()=>good.next(max),/ORES_I64_OVERFLOW/);
  assert.equal(bad.next(max),max+1n);
});

test('mutation: remainder-by-zero loses portable error category',async()=>{
  const esm=compileProgramV2('pub fnc main():int{return 1%0;}');
  const wrong=changeExactlyOnce(esm,'if(b===0n)','if(false)');
  const good=await load(esm,'remainder-good'),bad=await load(wrong,'remainder-bad');
  assert.throws(()=>good.main(),/ORES_I64_DIVISION_BY_ZERO/);
  assert.throws(()=>bad.main(),e=>e instanceof RangeError &&
    !e.message.includes('ORES_I64_DIVISION_BY_ZERO'));
});

test('mutation: named-call ABI reordering is semantically detected',async()=>{
  const source='fnc digits(int a,int b):int{return a*10+b;} '+
    'pub fnc main():int{return digits(b:2,a:4);}';
  const esm=compileProgramV2(source);
  const wrong=changeExactlyOnce(esm,'return _f0(_named1,_named0);',
    'return _f0(_named0,_named1);');
  const good=await load(esm,'named-good'),bad=await load(wrong,'named-bad');
  assert.equal(good.main(),42n);
  assert.equal(bad.main(),24n);
});

test('mutation: named-method ABI reordering is semantically detected',async()=>{
  const source='pub define class Box as '+
    'pub mtd digits(self,int a,int b):int{return a*10+b;} end '+
    'pub fnc main():int{return new Box().digits(b:2,a:4);}';
  const esm=compileProgramV2(source);
  const wrong=changeExactlyOnce(esm,
    'return _receiver["digits"](_namedMethod1,_namedMethod0);',
    'return _receiver["digits"](_namedMethod0,_namedMethod1);');
  const good=await load(esm,'method-good'),bad=await load(wrong,'method-bad');
  assert.equal(good.main(),42n);
  assert.equal(bad.main(),24n);
});

test('mutation: class receiver brand enforcement is observable',async()=>{
  const esm=compileProgramV2(
    'pub define class Box as pub read():int{return 42;} end');
  const wrong=changeExactlyOnce(esm,
    'if(this===null||(typeof this!=="object"&&typeof this!=="function")||!(#oresBrand in this))',
    'if(false)');
  const good=await load(esm,'brand-good'),bad=await load(wrong,'brand-bad');
  assert.throws(()=>good.Box.prototype.read.call({}),/invalid Oreslang receiver/);
  assert.equal(bad.Box.prototype.read.call({}),42n);
});

test('mutation: exported overload arity gate is observable',async()=>{
  const esm=compileProgramV2(
    'pub fnc pick():int{return 1;} pub fnc pick(int a):int{return a;}');
  const wrong=changeExactlyOnce(esm,
    'default:throw new TypeError("Oreslang overload arity mismatch");',
    'default:return 0n;');
  const good=await load(esm,'arity-good'),bad=await load(wrong,'arity-bad');
  assert.throws(()=>good.pick(1n,2n),/overload arity mismatch/);
  assert.equal(bad.pick(1n,2n),0n);
});

test('mutation: generator argument checking cannot be deferred until first pull',async()=>{
  const esm=compileProgramV2('pub gen* values(int n):Iterator<int>{yield n;return;}');
  const wrong=changeExactlyOnce(esm,'function _g0(_p0){\n_check(_p0);',
    'function _g0(_p0){');
  const good=await load(esm,'generator-good'),bad=await load(wrong,'generator-bad');
  assert.throws(()=>good.values(41),/BigInt required/);
  const badIterator=bad.values(41);
  assert.equal(typeof badIterator.next,'function');
  assert.throws(()=>badIterator.next(),/BigInt required/);
});

test('mutation: generator completion flag is observable',async()=>{
  const esm=compileProgramV2('pub gen* values():Iterator<int>{yield 42;return;}');
  const wrong=changeExactlyOnce(esm,
    'return Object.freeze({value:_step.value,done:_step.done});',
    'return Object.freeze({value:_step.value,done:false});');
  const good=await load(esm,'done-good'),bad=await load(wrong,'done-bad');
  const a=good.values(),b=bad.values();
  assert.equal(a.next().done,false);
  assert.equal(b.next().done,false);
  assert.equal(a.next().done,true);
  assert.equal(b.next().done,false);
});

test('mutation: match-case selected value is observable',async()=>{
  const esm=compileProgramV2(
    'pub fnc pick(int x):int{return match x over on 1 -> {42;} on _ -> {7;} end;}');
  const wrong=changeExactlyOnce(esm,'case 1n:return 42n;','case 1n:return 41n;');
  const good=await load(esm,'match-good'),bad=await load(wrong,'match-bad');
  assert.equal(good.pick(1n),42n);
  assert.equal(bad.pick(1n),41n);
});
