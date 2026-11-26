import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
async function guest(s){
  const esm=compileProgramV2(s),ir=compileToProgramIRV2(s);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
  return import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
}
test('trap wraps Option as Ok(payload), including None; nested trap preserves Result',async()=>{
  for(const [s,want] of [["pub fnc main():int{val x=trap Some(42);return Option.unwrap_or(x.unwrap(),0);}","42"],["pub fnc main():int{val x=trap! None;return x.is_ok()?Option.unwrap_or(x.unwrap(),42):0;}","42"],["pub fnc main():int{val x=trap Some(42);val y=trap x;return Option.unwrap_or(y.unwrap(),0);}","42"],["pub fnc main():int{val x=trap None;val y=trap! x;return y.is_ok()?Option.unwrap_or(y.unwrap(),42):0;}","42"],["pub fnc main():Option<int>{val x=trap Some(42);return x.unwrap();}","Some"],["pub fnc main():Option<int>{val x=trap None;return x.unwrap();}","None"],["fnc payload(int d):Option<int>{return Some(42/d);} pub fnc main():int{val x=trap payload(0);return x.is_err()?42:0;}","42"],["fnc payload(int d):Option<int>{return Some(42/d);} pub fnc main():int{val x=trap! payload(1);return Option.unwrap_or(x.unwrap(),0);}","42"],["pub fnc main():int{val x=trap Ok(42);val y=trap x;return y.unwrap();}","42"],["pub fnc main():int{val x=trap Err(7);return x.is_err()?42:0;}","42"],["pub fnc main():int{val x=trap (7/0);return x.is_err()?42:0;}","42"]]){
    const got=(await guest(s)).main();
    if(want==='Some'||want==='None'){
      assert.equal(got.kind,want,s);assert.equal(got.value,want==='Some'?42n:null);assert.ok(Object.isFrozen(got));
    }else assert.equal(got,BigInt(want),s);
  }
});
test('Option trap payload cannot be treated as a scalar or escaped as untyped Result',()=>{
  for(const s of ["pub fnc main():int{val x=trap Some(42);return x.unwrap();}","pub fnc main():int{val x=trap Some(42);return x;}","pub fnc main():int{val x=trap None;return x.unwrap()+1;}","pub fnc main():int{val x=trap true;return 42;}","pub fnc main():int{val x=trap 42;return Option.unwrap_or(x.unwrap(),0);}","pub fnc main():int{val x=trap Some(42);return x.is_ok(1)?42:0;}"])assert.throws(()=>compileProgramV2(s),/error: program (v2|IR):/,s);
});
test('trapOption IR is type- and scope-checked',()=>{
  for(const mutate of [
    x=>x.functions[0].body.kind='trapLocal',
    x=>x.functions[0].body.init.operandType='int',
    x=>x.functions[0].body.body.args[0].kind='trapMethod',
    x=>x.functions[0].body.body.args[0].receiver.kind='trapCapture',
    x=>x.functions[0].body.body.args[0].receiver.slot=99
  ]){
    const ir=compileToProgramIRV2("pub fnc main():int{val x=trap Some(42);return Option.unwrap_or(x.unwrap(),0);}");
    mutate(ir);assert.throws(()=>compileProgramIRV2(ir),/error: program IR:/);
  }
});
test('failed unwrap of Result<Option<int>,Error> is an ordinary guest error',async()=>{
  const source="fnc payload():Option<int>{return Some(7/0);} fnc bad():int{val x=trap payload();return Option.unwrap_or(x.unwrap(),0);}";
  const captured=await guest(source+" pub fnc main():int{val x=trap! bad();return x.is_err()?42:0;}");
  assert.equal(captured.main(),42n);
  const uncaught=await guest(source+" pub fnc main():int{return bad();}");
  assert.throws(()=>uncaught.main(),e=>e.name==='ResultUnwrapError'&&e.cause.abiCode===65538&&Object.isFrozen(e));
});
test('checked unwrap retains original scalar Err and nested trap captures it',async()=>{
  const g=await guest("pub fnc main():int{val x=trap Err(7);val y=trap! x.unwrap();return y.is_err()?42:0;}");
  assert.equal(g.main(),42n);
  const uncaught=await guest("pub fnc main():int{val x=trap Err(7);return x.unwrap();}");
  assert.throws(()=>uncaught.main(),e=>e.name==='ResultUnwrapError'&&e.cause===7n);
});
test('explicit panic and raise still bypass trap',async()=>{
  for(const effect of ['panic!','raise!']){
    const g=await guest('fnc fail():int{'+effect+' new Error("terminal");} pub fnc main():int{val r=trap! fail();return r.is_err()?42:0;}');
    assert.throws(()=>g.main(),e=>e.effect===effect.slice(0,-1)&&e.message==='terminal');
  }
});
