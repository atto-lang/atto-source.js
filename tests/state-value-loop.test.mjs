import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const exact=[["220-recur-sum",45,"adf984b7e7c7e1dd864460e89db50e47f0ee50dd"],["221-recur-parallel-fibonacci",13,"5ea7a41aa0052b55ff6d10eebce7561dbe78fe8b"],["227-recur-source-order-init",6,"4ec369653a9b333c61449a02b4c06fc8e51f4d07"],["229-recur-constant-stack",100000,"33d71fc35d920b086cda844577228cb6bdb3d45e"]];
let seq=0;
async function run(source){
 const js=compileProgramV2(source);
 const uri='data:text/javascript;base64,'+Buffer.from(js+'\n// unique '+seq++).toString('base64');
 return (await import(uri)).main();
}
for(const [id,expected,sha] of exact)test(id,async()=>{
 const b=readFileSync(new URL('fixtures/value-loop-recur-v1/'+id+'.atto',import.meta.url));
 assert.equal(createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),sha);
 assert.equal(await run(b.toString('utf8')),BigInt(expected));
});
const program=x=>'pub fnc main():int { return '+x+'; }';
test('parallel swap and arbitrary arithmetic expression position',async()=>{
 assert.equal(await run(program('2 + loop (val i:int=0,val a:int=1,val b:int=40) { if i >= 1 { break a; } recur(i+1,b,a); }')),42n);
});
test('reject arity, types, non-tail, mutable state, captures, missing break and fallthrough',()=>{
 for(const x of [
  'loop (val i:int=0) { if i>=1 { break i; } recur(i+1,2); }',
  'loop (val i:int=0) { if i>=1 { break i; } recur(true); }',
  'loop (val i:int=0) { if i>=1 { break i; } recur(i+1); recur(i+1); }',
  'loop (let i:int=0) { if i>=1 { break i; } recur(i+1); }',
  'loop (val i:int=0) { if i>=1 { break outside; } recur(i+1); }',
  'loop (val i:int=0) { recur(i+1); }',
  'loop (val i:int=0) { if i>=1 { break i; } }',
  'loop (val i:int=0) { if 1 { break i; } recur(i+1); }',
  'loop (val i:int=0) { if true { break true; } recur(i+1); }'
 ])assert.throws(()=>compileProgramV2(program(x)),x);
});
test('external IR revalidation refuses stale state references and wrong arity',()=>{
 const ir=compileToProgramIRV2(program('loop (val i:int=0) { if i>=2 { break i; } recur(i+1); }'));
 const body=ir.functions[0].body;
 assert.equal(body.kind,'closedRecur');
 assert.ok(compileProgramIRV2(ir).includes('while('));
 for(const mutate of [d=>d.updates=[],d=>d.result={kind:'capture',slot:99999},d=>d.condition={kind:'int',value:'1'},d=>d.updates=[{kind:'param',index:0}]]){
  const copy=structuredClone(ir);mutate(copy.functions[0].body);assert.throws(()=>compileProgramIRV2(copy));
 }
});
