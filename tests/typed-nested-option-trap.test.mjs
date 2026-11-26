import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const source='fnc optional(bool p):Option<int>{return p?Some(42):None;} pub fnc main(bool p):int { val Result<Option<int>, Error> r=trap! optional(p); return r.is_ok()?42:0; }';
test('typed nested Option Result treats None as successful data',async()=>{
 const ir=compileToProgramIRV2(source), esm=compileProgramV2(source);
 assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
 const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
 assert.equal(guest.main(true),42n);
 assert.equal(guest.main(false),42n);
});
test('typed nested trap rejects scalar, wrong payload, and forged slot type',()=>{
 for(const bad of [source.replace('trap! optional(p)','trap! 42'),source.replace('Result<Option<int>, Error>','Result<int, Error>'),source.replace('trap! optional(p)','optional(p)'),source.replace('Option<int>, Error','Option<bool>, Error')])
   assert.throws(()=>compileProgramV2(bad),/error:/,bad);
 const ir=compileToProgramIRV2(source);
 const local=ir.functions.find(f=>f.name==='main').body;
 assert.equal(local.kind,'trapOptionLocal');
 local.kind='trapLocal';
 assert.throws(()=>compileProgramIRV2(ir),/error:/);
});

test('nested trap unwrap preserves the actual Option tag and scalar payload',async()=>{
 const input='fnc optional(bool p):Option<int>{return p?Some(42):None;} pub fnc main(bool p):int { val Result<Option<int>, Error> r=trap! optional(p); val Option<int> x=r.unwrap(); return Option.is_some(x)?Option.unwrap_or(x,0):Option.unwrap_or(x,17); }';
 const ir=compileToProgramIRV2(input), esm=compileProgramV2(input);
 assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
 const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
 assert.equal(guest.main(true),42n);
 assert.equal(guest.main(false),17n);
});
test('nested trap verifier rejects retagging the captured payload as a scalar',()=>{
 const ir=compileToProgramIRV2(source);
 const local=ir.functions.find(f=>f.name==='main').body;
 assert.equal(local.kind,'trapOptionLocal');
 assert.equal(local.init.operandType,'option<int>');
 local.init.operandType='int';
 assert.throws(()=>compileProgramIRV2(ir),/error:/);
});
