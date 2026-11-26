import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const source='fnc rhs(): bool { val Option<bool> missing = None; return missing.unwrap(); } fnc conjunction(bool run): bool { return run && rhs(); } fnc disjunction(bool skip): bool { return skip || rhs(); } pub fnc main(): int { val Result<bool, Error> a = trap! conjunction(false); val Result<bool, Error> b = trap! disjunction(true); val Result<bool, Error> c = trap! conjunction(true); val Result<bool, Error> d = trap! disjunction(false); guard a.is_ok(), b.is_ok(), c.is_err(), d.is_err() { return 1; } guard !a.unwrap(), b.unwrap() { return 2; } return 42; }';
test('Boolean traps preserve lazy branch effects and true/false payloads',async()=>{
 const ir=compileToProgramIRV2(source),esm=compileProgramV2(source);
 assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
 const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
 assert.equal(guest.main(),42n);
});
test('Boolean option Some payload validated and forged trap type rejected',async()=>{
 const input='pub fnc main(): bool { val Option<bool> x=Some(true); return x.unwrap(); }';
 const guest=await import('data:text/javascript,'+encodeURIComponent(compileProgramV2(input)));
 assert.equal(guest.main(),true);
 assert.throws(()=>compileProgramV2(input.replace('Some(true)','Some(42)')),/error:/);
 const ir=compileToProgramIRV2(source);
 const root=ir.functions.find(f=>f.name==='main').body;
 root.init.operandType='int';
 assert.throws(()=>compileProgramIRV2(ir),/error:/);
});
