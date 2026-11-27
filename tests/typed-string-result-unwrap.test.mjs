import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const source='fnc outcome(bool p): Result<int, String> { if p do return Ok(42); fi return Err("original"); } pub fnc main(bool p): int { return outcome(p).unwrap(); }';
test('private typed String Result preserves the exact cause on checked unwrap',async()=>{
 const ir=compileToProgramIRV2(source),esm=compileProgramV2(source);
 assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
 const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
 assert.equal(guest.main(true),42n);
 assert.throws(()=>guest.main(false),e=>e.name==='ResultUnwrapError'&&e.cause==='original');
});
test('typed String Result rejects wrong payload and forged intrinsic',()=>{
 for(const bad of [source.replace('Err("original")','Err(7)'),source.replace('Ok(42)','Ok("bad")'),source.replace('fnc outcome','pub fnc outcome')])assert.throws(()=>compileProgramV2(bad),/error:/);
 const ir=compileToProgramIRV2(source);
 const root=ir.functions.find(f=>f.name==='outcome').body;
 root.no.name='Result.err';
 assert.throws(()=>compileProgramIRV2(ir),/error:/);
});
