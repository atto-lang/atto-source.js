import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,IncrementalSession} from '../src/compiler.mjs';
const first='fnc helper(int x): int { return x+1; } pub fnc main(): int { return helper(41); }';
const run=async code=>(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).main();
test('real scalar IR code generation reuses only exact checked function fragments',async()=>{
 const s=new IncrementalSession();const a=s.build(first,{cold:true});assert.deepEqual([a.emitted,a.reused],[2,0]);assert.equal(a.code,compile(first));assert.equal(await run(a.code),42n);
 const b=s.build(first);assert.deepEqual([b.emitted,b.reused],[0,2]);assert.equal(b.code,a.code);
 const edit=first.replace('x+1','x+2');const c=s.build(edit);assert.deepEqual([c.emitted,c.reused],[1,1]);assert.equal(c.code,compile(edit));assert.equal(await run(c.code),43n);
 const bad=edit.replace('helper(41)','missing(41)');let diagnostic;try{compile(bad)}catch(e){diagnostic=e.message;}assert.ok(diagnostic);assert.throws(()=>s.build(bad),e=>e.message===diagnostic);
 const recovered=s.build(edit);assert.deepEqual([recovered.emitted,recovered.reused],[0,2]);
 const shifted='fnc extra(): int { return 0; } '+edit;const d=s.build(shifted);assert.equal(d.code,compile(shifted));assert.equal(await run(d.code),43n);assert.equal(d.emitted,3);
 console.log('INCREMENTAL_JS|actual-esm=42/43|fragments=2/0,0/2,1/1|slot-shift|rollback');
});
