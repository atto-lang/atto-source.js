// Empty ordinary-throw row is not a blanket guarantee of normal return.
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
async function load(source) {
  const ir=compileToProgramIRV2(source);
  const esm=compileProgramV2(source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
  return import('data:text/javascript,'+encodeURIComponent(esm));
}
test('empty ordinary row discharges transitive throw only at the trap boundary',async()=>{
  const prefix='fnc fail():int throws(Error){throw! new Error("ordinary");} fnc middle():int throws(Error){return fail();} ';
  const good=prefix+'pub fnc main():int throws(){val r=trap! middle();return r.is_err()?42:0;}';
  assert.equal((await load(good)).main(),42n);
  const bad=prefix+'pub fnc main():int throws(){return middle();}';
  assert.throws(()=>compileProgramV2(bad),/E_EFFECT/);
  const forged=compileToProgramIRV2(good);
  forged.functions.find(f=>f.name==='middle').throws=[];
  assert.throws(()=>compileProgramIRV2(forged),/E_EFFECT/);
});
test('empty ordinary row does not discharge terminal panic or raise inside trap',async()=>{
  for(const effect of ['panic','raise']){
    const src='fnc fatal():int{'+effect+'! new Error("terminal");} pub fnc main():int throws(){val r=trap! fatal();return r.is_err()?42:0;}';
    const guest=await load(src);
    assert.throws(()=>guest.main(),e=>e.effect===effect&&e.message==='terminal');
  }
});
test('a match arm throwing outside the trap must be rejected by an empty row',()=>{
  const source='fnc fail():int throws(Error){throw! new Error("arm");} pub fnc main():int throws(){val Option<int> x=None;return trap! x.unwrap() |> match<int> over on Ok(n):int -> n,on Err():int -> fail(),end;}';
  assert.throws(()=>compileProgramV2(source),/E_EFFECT/);
});
