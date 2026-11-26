import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
async function guest(source){
  const esm=compileProgramV2(source),ir=compileToProgramIRV2(source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
  return import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
}
test('core Error throw aliases are captured by trap, including Option payloads',async()=>{
  for(const [source,want] of [["fnc fail_now():int{throw new Error(\"ordinary\");} pub fnc main():int{val r=trap fail_now();return r.is_err()?42:0;}","42"],["fnc fail_now():Option<int>{throw new Error(\"ordinary\");} pub fnc main():int{val r=trap! fail_now();return r.is_err()?42:0;}","42"],["fnc fail_now():int{throw! new Error(\"ordinary\");} pub fnc main():int{val r=trap fail_now();return r.is_err()?42:0;}","42"],["fnc fail_now():Option<int>{throw! new Error(\"ordinary\");} pub fnc main():int{val r=trap! fail_now();return r.is_err()?42:0;}","42"],["fnc f(int x):int{if x eq 0 then throw new Error(\"zero\");fi return x;} pub fnc main():int{val r=trap f(42);return r.unwrap();}","42"],["fnc f(int x):int{if x eq 0 then throw new Error(\"zero\");fi return x;} pub fnc main():int{val r=trap f(0);return r.is_err()?42:0;}","42"]])assert.equal((await guest(source)).main(),BigInt(want),source);
});
test('raise and panic cross trap without Err conversion in scalar host boundary',async()=>{
  for(const [source,effect] of [["fnc f():int{raise new Error(\"boundary\");} pub fnc main():int{val r=trap f();return r.is_err()?42:0;}","raise"],["fnc f():int{raise! new Error(\"boundary\");} pub fnc main():int{val r=trap f();return r.is_err()?42:0;}","raise"],["fnc f():int{panic new Error(\"boundary\");} pub fnc main():int{val r=trap f();return r.is_err()?42:0;}","panic"],["fnc f():int{panic! new Error(\"boundary\");} pub fnc main():int{val r=trap f();return r.is_err()?42:0;}","panic"]]){
    const g=await guest(source);
    assert.throws(()=>g.main(),e=>e.effect===effect&&e.message==='boundary'&&Object.isFrozen(e));
  }
});
test('unsupported effects, non-Error payloads and unreachable statements fail before artifact',()=>{
  for(const source of ["pub fnc main():int{throw 42;}","pub fnc main():int{panic! new Foo(\"bad\");}","pub fnc main():int{raise! new Error(42);}","pub fnc main():int{throw new Error(\"bad\");return 42;}","pub fnc main():int{return panic! Error(\"bad\");}","pub fnc main(int Error):int{throw new Error(\"shadowed\");}","pub fnc main():int{throw new Error(\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\");}","pub fnc main():int{throw new Error(\"bad\\n\");}","pub fnc main():int{val r=trap await f();return 42;}"])assert.throws(()=>compileProgramV2(source),undefined,source);
});
test('typed guest effect IR refuses unsupported kinds and malformed message records',()=>{
  for(const mutate of [v=>v.functions[0].body.effect='cancel',v=>v.functions[0].body.message=42,v=>v.functions[0].body.message='x'.repeat(257),v=>v.functions[0].body.message='\n']){
    const ir=compileToProgramIRV2("pub fnc main():int{throw new Error(\"ordinary\");}");mutate(ir);
    assert.throws(()=>compileProgramIRV2(ir),/error: program IR:/);
  }
});
test('checked unwrap preserves original ordinary guest error and is captured by outer trap',async()=>{
  const source='fnc f():int{throw new Error("ordinary");} fnc g():int{val r=trap f();return r.unwrap();}';
  const g=await guest(source+' pub fnc main():int{val r=trap g();return r.is_err()?42:0;}');
  assert.equal(g.main(),42n);
  const raw=await guest(source+' pub fnc main():int{return g();}');
  assert.throws(()=>raw.main(),e=>e.name==='ResultUnwrapError'&&e.cause.message==='ordinary'&&e.cause.effect==='throw');
});
