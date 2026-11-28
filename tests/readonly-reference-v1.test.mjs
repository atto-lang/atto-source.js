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
  assert.match(code,/function f0\(p\)\{\s*return p\.f1;\}/);
  assert.match(code,/function f1\(p\)\{\s*return f0\(p\);\}/);
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

const MIXED= `// atto-ownership: borrow-default-v1
define class Parcel as pub let int padding = 99; pub let int value = 20; end
fnc sum(Parcel a, int n, Parcel b): int { val int left = a.value + n; val int right = b.value; return left + right; }
fnc forward(Parcel p, int n): int { val int result = sum(p, n, p); return result; }
pub fnc main(): int { let p = new Parcel(); val int n = 2; return forward(p, n); }`;
test('mixed readonly scalar SSA, same original object and checked nested arithmetic',async()=>{
  const code=compile(MIXED);
  assert.match(code,/function f0\(p,v1,v2\)/);
  assert.match(code,/f0\(p,v1,p\)/);
  assert.equal(code.match(/const p=\{/g).length,1);
  const good=await load(MIXED), bad=await load(MIXED.replace('value = 20','value = 9223372036854775807'));
  for(let i=0;i<1000;i++){
    assert.equal(good.main(),42n);
    assert.throws(()=>bad.main(),RangeError);
  }
  assert.equal(good.main(),42n);
});
test('mixed argument and binding authority rejected before output',()=>{
  for(const bad of [
    MIXED.replace('sum(p, n, p)','sum(p, p, p)'),
    MIXED.replace('sum(p, n, p)','sum(n, n, p)'),
    MIXED.replace('sum(p, n, p)','sum(p, n, new Parcel())'),
    MIXED.replace('val int right','val int left'),
    MIXED.replace('val int right','left = 1; val int right'),
    MIXED.replace('return left + right;','return a;'),
    MIXED.replace('a.value + n','right'),
    MIXED.replace('a.value + n','('.repeat(20)+'n'+')'.repeat(20)),
    MIXED.replace('sum(p, n, p)','forward(p, n)'),
  ])assert.throws(()=>compile(bad),undefined,bad);
});
