import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2} from '../src/program-v2.mjs';
import {transpile_to_worker} from '../src/transpile-worker.mjs';

const source=expr=>'pub fnc main(): int { return '+expr+'; }';
const moduleOf=code=>import('data:text/javascript;charset=utf-8,'+encodeURIComponent(code));
const profiles=[
  ['program-v2',compileProgramV2,async code=>(await moduleOf(code)).main()],
  ['worker',src=>transpile_to_worker(src).module_source,async code=>{
    const m=await moduleOf(code);
    return BigInt((await (await m.create_tenant({tenant:'shift-test',generation:1})).on_message()).value);
  }],
];
const expected=(a,n)=>{
  const factor=2n**n, q=a/factor;
  return a<0n&&a%factor!==0n?q-1n:q;
};

for(const [label,compile,run] of profiles){
  test(label+': arithmetic right shift preserves signed bits and precedence',async()=>{
    const edges=[-(1n<<63n),-9007199254740993n,-9n,-8n,-1n,0n,1n,9n,9007199254740993n,(1n<<63n)-1n];
    for(const a of edges)for(const n of [0n,1n,2n,31n,32n,63n]){
      const expr='('+a+') ashr '+n;
      assert.equal(await run(compile(source(expr))),expected(a,n),expr);
    }
    for(const [expr,value] of [['-8 ashr 1 + 1',-2n],['(-8 ashr 1) + 1',-3n],['-1 >>> 1',9223372036854775807n],['1 <<< 63',-(1n<<63n)]]){
      assert.equal(await run(compile(source(expr))),value,expr);
    }
    let seed=0x3419132b;
    const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    for(let i=0;i<128;i++){
      const a=BigInt.asIntN(64,(BigInt(next())<<32n)|BigInt(next()));
      const n=BigInt(next()&63);
      assert.equal(await run(compile(source('('+a+') ashr '+n))),expected(a,n));
    }
  });
  test(label+': shift counts reject rather than mask',async()=>{
    for(const e of ['1 ashr 64','1 ashr -1'])assert.throws(()=>compile(source(e)),/E_SHIFT_DISTANCE/);
    for(const e of ['-8 ashr (63+1)','-8 ashr (0-1)'])await assert.rejects(async()=>run(compile(source(e))),/E_GUEST_SHIFT_DISTANCE/);
    for(const e of ['true ashr 1','1 ashr true','1 ashr 1.0'])assert.throws(()=>compile(source(e)));
  });
}
