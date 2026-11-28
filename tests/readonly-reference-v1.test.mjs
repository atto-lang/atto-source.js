import test from 'node:test';
import assert from 'node:assert/strict';
import {compileReadonlyReferenceV1 as compile} from '../src/readonly-reference-v1.mjs';
const S=`// atto-ownership: borrow-default-v1
define class Parcel as pub let int padding = 99; pub let int value = 21; end
fnc get(Parcel p): int { return p.value; }
fnc forward(Parcel p): int { return get(p); }
pub fnc main(): int { let p = new Parcel(); return forward(p) + get(p); }`;
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(compile(s)).toString('base64'));
test('closed reference ESM executes direct original object forwarding',async()=>{
  const code=compile(S);
  assert.match(code,/function f0\(p\)\{return p\.f1;\}/);
  assert.match(code,/function f1\(p\)\{return f0\(p\);\}/);
  assert.equal(code.match(/const p=\{/g).length,1);
  const mod=await load(S);
  assert.deepEqual(Object.keys(mod),['main']);
  for(let i=0;i<1000;i++)assert.equal(mod.main(),42n);
});
test('checked overflow and independent repeated roots',async()=>{
  const mod=await load(S.replace('value = 21','value = 9223372036854775807'));
  assert.throws(()=>mod.main(),/overflow/);
  const normal=await load(S);
  assert.equal(normal.main(),42n);
});
test('closed source denial before ESM publication',()=>{
  for(const bad of [
    S.replace('return get(p);','return forward(p);'),
    S.replace('return p.value;','return p.missing;'),
    S.replace('return get(p);','return get(new Parcel());'),
    S.replace('Parcel p','mut Parcel p'),
    S.replace('return p.value;','p.value = 1; return p.value;'),
    S.replace('value = 21','value = 9223372036854775808'),
    S.replace('value = 21','value = 1_0'),
    S.replace('padding = 99','value = 99'),
    S.replace('return forward(p) + get(p);','return forward(p) * get(p);'),
    S.replace('return p.value;','return p."value";'),
    S.replace('return p.value;','return p.value; // \u202e'),
    S+'\nimport x;',
    S.replace('// atto-ownership: borrow-default-v1\n','')
  ])assert.throws(()=>compile(bad),undefined,bad);
});
