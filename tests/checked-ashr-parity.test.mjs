import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2,compileAttoScalarV1} from '../src/program-v2.mjs';
import {transpile_to_worker} from '../src/transpile-worker.mjs';
const source='pub fnc arithmetic(int a,int n):int {return a ashr n;} pub fnc logical(int a,int n):int{return a >>> n;} pub fnc main():int{return arithmetic(-84,1)+84;}';
const load=esm=>import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
const lo=-(1n<<63n),hi=(1n<<63n)-1n,mask=(1n<<64n)-1n;
const floor=(a,n)=>{const p=2n**n;return a<0n?-((-a+p-1n)/p):a/p;};
test('actual checked ESM and scalar-v1 arithmetic shifts preserve signed values and reject full-width invalid distances',async()=>{
  const ir=compileToProgramIRV2(source);
  const esm=compileProgramV2(source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
  assert.equal(compileAttoScalarV1(source),esm);
  const guest=await load(esm);assert.equal(guest.main(),42n);
  let state=0x1387d20f;
  const next=()=>state=(Math.imul(state,1664525)+1013904223)>>>0;
  const signed=()=>BigInt.asIntN(64,(BigInt(next())<<32n)|BigInt(next()));
  const edges=[lo,lo+1n,-9007199254740993n,-84n,-3n,-1n,0n,1n,84n,hi];
  const check=(a,n)=>{assert.equal(guest.arithmetic(a,n),floor(a,n));assert.equal(guest.logical(a,n),BigInt.asIntN(64,(a&mask)/(2n**n)));};
  for(const a of edges)for(let n=0n;n<64n;n++)check(a,n);
  for(let i=0;i<100000;i++)check(signed(),BigInt(next()&63));
  for(const n of [lo,-4294967296n,-65n,-1n,64n,65n,4294967296n,hi]){
    assert.throws(()=>guest.arithmetic(-1n,n),/E_GUEST_SHIFT_DISTANCE/);
    assert.throws(()=>guest.logical(-1n,n),/E_GUEST_SHIFT_DISTANCE/);
  }
});
test('arithmetic shift precedence, compile-time distance checks, and lexical identity',async()=>{
  for(const [expr,want] of [['(-84) ashr 1',-42n],['-1 ashr 63',-1n],['(-9223372036854775808) ashr 63',-1n],['-84 + 0 ashr 1',-42n],['-168 ashr 1+1',-42n]]){
    const m=await load(compileProgramV2('pub fnc main():int{return '+expr+';}'));assert.equal(m.main(),want,expr);
  }
  for(const expr of ['1 ashr 64','1 ashr -1','1 ashr 1.0','true ashr 1'])assert.throws(()=>compileProgramV2('pub fnc main():int{return '+expr+';}'));
});
test('inline worker tasks execute arithmetic right shift and deny invalid distances',async()=>{
  const run=async expr=>{const out=transpile_to_worker('pub fnc main():int{return sync task<int>{return '+expr+';};}');const m=await load(out.module_source);return (await (await m.create_tenant({tenant:'test',generation:1})).on_message()).value;};
  assert.equal(await run('-84 ashr 1'),'-42');
  assert.equal(await run('-1 ashr 63'),'-1');
  assert.equal(await run('-168 ashr 1+1'),'-42');
  await assert.rejects(run('1 ashr (63+1)'),/E_GUEST_SHIFT_DISTANCE/);
  await assert.rejects(run('1 ashr (0-1)'),/E_GUEST_SHIFT_DISTANCE/);
});
