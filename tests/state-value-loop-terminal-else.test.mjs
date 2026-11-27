import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const wrap=x=>'pub fnc main():int { return '+x+'; }';
const expr='loop (val i = 0,val a=2,val b=42) { if i eq 1 { break a; } else { recur(i+1,b,a); } }';
test('terminal else recur has identical checked IR and emitted guest',async()=>{
 const source=wrap(expr), direct=wrap(expr.replace('else { recur(i+1,b,a); }','recur(i+1,b,a);'));
 const ir=compileToProgramIRV2(source), esm=compileProgramV2(source);
 assert.deepEqual(ir,compileToProgramIRV2(direct));
 assert.equal(esm,compileProgramIRV2(JSON.parse(JSON.stringify(ir))));
 assert.equal((await import('data:text/javascript,'+encodeURIComponent(esm))).main(),42n);
});
test('earlier guard wins before terminal else and avoids untaken arithmetic',async()=>{
 const src=wrap('loop (val i=0) { if true { break 42; } if i/0 eq 0 { break 1; } else { recur(i/0); } }');
 assert.equal((await import('data:text/javascript,'+encodeURIComponent(compileProgramV2(src)))).main(),42n);
});
test('reject missing, non-tail and mismatched terminal else backedges',()=>{
 for(const body of [
 'loop (val i=0) { if i eq 1 { break i; } else {} }',
 'loop (val i=0) { if i eq 1 { break i; } else { recur(i+1); recur(i+2); } }',
 'loop (val i=0) { if i eq 1 { break i; } else { recur(true); } }',
 'loop (val i=0) { if i eq 1 { break i; } else { recur(i+1); } recur(i+2); }',
 'loop (val i=0) { if i eq 1 { break i; } else { break 42; } }'
 ])assert.throws(()=>compileProgramV2(wrap(body)),/error:/);
});
