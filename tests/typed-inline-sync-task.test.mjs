import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const opt={stdout:true};
const input='pub fnc main(bool present):int { let int count=0; val Option<int> x=present?Some(3):None; val Result<int, Error> r=trap! sync task<int>{count=count+2; defer stdio.out.write("A"); defer process.stdout.write("B"); val int n=x.unwrap(); count=count+100; return n;}; return r.is_err()?count+40:count+r.unwrap(); }';
test('inline task executes ordered writes and LIFO cleanup on success and error',async()=>{
 const ir=compileToProgramIRV2(input,opt),esm=compileProgramV2(input,opt);
 assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir)),opt),esm);
 const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
 let out='';
 assert.equal(guest.main(s=>{out+=s;},false),42n);assert.equal(out,'BA');
 out='';assert.equal(guest.main(s=>{out+=s;},true),105n);assert.equal(out,'BA');
 assert.throws(()=>guest.main(()=>{throw new Error('host');},false),/stdout capability failed/);
});
test('inline task denies immutable capture, wrong type, missing return and forged slot',()=>{
 for(const bad of [input.replace('let int count','val int count'),input.replace('count=count+2','count=true'),input.replace('return n;',''),input.replace('task<int>','task<bool>')])assert.throws(()=>compileProgramV2(bad,opt),/error:/);
 assert.throws(()=>compileProgramV2(input),/E_SYNC_TASK_PROFILE/);
 const ir=compileToProgramIRV2(input,opt);
 const root=ir.functions[0].body;
 assert.equal(root.kind,'taskMutableLocal');
 root.kind='local';assert.throws(()=>compileProgramIRV2(ir,opt),/error:/);
});
