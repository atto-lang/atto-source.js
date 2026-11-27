import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const wrap=x=>'pub fnc main():int { return '+x+'; }';
const body='loop (val i = 0, val a = 2, val b = a + 40) { if i eq 1 { break a; } recur(i + 1, b, a); }';
test('infer sequential immutable integer states and swap simultaneously',async()=>{
 const src=wrap(body),esm=compileProgramV2(src),ir=compileToProgramIRV2(src);
 assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
 assert.equal((await import('data:text/javascript,'+encodeURIComponent(esm))).main(),42n);
 assert.deepEqual(ir,compileToProgramIRV2(wrap(body.replace('val i =','val i:int =').replace('val a =','val a:int =').replace('val b =','val b:int ='))));
});
test('reject noninteger inference, forward references and incompatible recur updates',()=>{
 for(const body of [
 'loop (val a = b, val b = 42) { if true { break a; } recur(a,b); }',
 'loop (val i = true) { if true { break 42; } recur(i); }',
 'loop (val i = 1.0) { if true { break 42; } recur(i); }',
 'loop (val i = 0) { if i eq 1 { break i; } recur(true); }',
 'loop (val i:bool = true) { if true { break 42; } recur(i); }',
 'loop (let i = 0) { if true { break i; } recur(i); }'
 ])assert.throws(()=>compileProgramV2(wrap(body)),/error:/);
});
