import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

const load=async source=>{
 const ir=compileToProgramIRV2(source), esm=compileProgramV2(source);
 assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
 return import('data:text/javascript,'+encodeURIComponent(esm));
};
const match=(receiver,trap='trap!')=>trap+' '+receiver+'.unwrap() |> match<int> over on Ok(n): int -> n, on Err(): int -> 42, end';
const optionSource=(expr=match('x'))=>'fnc choose(Option<int> x):int{return '+expr+';} pub fnc main(bool present):int{return choose(present ? Some(7) : None);}';
const resultSource='fnc choose(Result<int,int> x):int{return '+match('x')+';} pub fnc main(bool present):int{return choose(present ? Ok(7) : Err(9));}';

test('dynamic Option and Result unwrap select only the corresponding typed match arm',async()=>{
 for(const source of [optionSource(),optionSource(match('x','trap')),resultSource]){
  const guest=await load(source);
  assert.equal(guest.main(true),7n);
  assert.equal(guest.main(false),42n);
 }
});
test('untrapped checked unwrap retains original scalar cause and correct nominal name',async()=>{
 const guest=await load('fnc raw(Result<int,int> x):int{return x.unwrap();} pub fnc main():int{return raw(Err(9));}');
 assert.throws(()=>guest.main(),e=>e.name==='ResultUnwrapError'&&e.cause===9n&&Object.isFrozen(e));
 const option=await load('fnc raw(Option<int> x):int{return x.unwrap();} pub fnc main():int{return raw(None);}');
 assert.throws(()=>option.main(),e=>e.name==='OptionUnwrapError'&&Object.isFrozen(e));
});
test('downstream match arm throw is outside upstream trap',async()=>{
 const source='fnc arm():int{throw! new Error("arm");} '+optionSource(match('x').replace('-> 42','-> arm()'));
 const guest=await load(source);
 assert.equal(guest.main(true),7n);
 assert.throws(()=>guest.main(false),e=>e.effect==='throw'&&e.message==='arm');
});
test('typed match and checked unwrap reject invalid source and forged IR',()=>{
 for(const expr of [match('x').replace('unwrap()','unwrap(1)'),match('x').replace('x.unwrap','y.unwrap'),match('x').replace('Err()','Err(e)').replace('-> 42','-> e'),match('x').replace('-> 42','-> true'),match('x').replace('on Err(): int -> 42,',''),match('x').replace('match<int>','match<bool>')])
  assert.throws(()=>compileProgramV2(optionSource(expr)),/error:/,expr);
 for(const mutate of [
  ir=>ir.functions[0].body.subject.inner.name='Result.unwrap',
  ir=>ir.functions[0].body.adt='result<int,int>',
  ir=>{ir.functions[0].body.arms[1].slot=17;ir.functions[0].body.arms[1].body={kind:'capture',slot:17};},
  ir=>ir.functions[0].body.subject.inner.args.push({kind:'int',value:'1'}),
  ir=>ir.functions[0].body.arms.pop()
 ]){
  const ir=compileToProgramIRV2(optionSource());mutate(ir);
  assert.throws(()=>compileProgramIRV2(ir),/error: program IR:/);
 }
});

const exact = `declare type Bounded = int where self >= 1 and self <= 42;

pub fnc main() -> int {
    val Option<int> x = None;

    return trap! x.unwrap() |> match<int>  over
        on Ok(n): int -> n,
        on Err(): int -> 42,
    end;
}
`;
test('exact user source and local dynamic Some/None compile and execute',async()=>{
 assert.equal((await load(exact)).main(),42n);
 assert.equal((await load(exact.replace('= None;','= Some(7);'))).main(),7n);
 const dynamic=exact.replace('pub fnc main()','pub fnc main(bool present)').replace('= None;','= present ? Some(7) : None;');
 const guest=await load(dynamic);assert.equal(guest.main(true),7n);assert.equal(guest.main(false),42n);
 const result=exact.replace('Option<int> x = None','Result<int,int> x = Err(9)');
 assert.equal((await load(result)).main(),42n);
});
test('refinements are validated, not erased when active or invalid; locals are typed',()=>{
 for(const s of [exact.replace('<= 42','<= 0'),exact.replace('Bounded','Option'),exact.replace('Option<int> x','Option<Bounded> x'),exact.replace('= None;','= 42;'),exact.replace('= None;','= Err(7);'),exact.replace('val Option','let Option')])
  assert.throws(()=>compileProgramV2(s),/error:/,s);
 const ir=compileToProgramIRV2(exact);
 ir.functions[0].body.body.subject.inner.args[0].slot=99;
 assert.throws(()=>compileProgramIRV2(ir),/error: program IR:/);
});
test('declare type also uses existing scalar refinement checks',async()=>{
 const source='declare type Bounded = int where self >= 1 and self <= 42; pub fnc main() -> int { val Bounded n = 42; return n; }';
 assert.equal((await load(source)).main(),42n);
 assert.throws(()=>compileProgramV2(source.replace('= 42; return','= 43; return')),/error:/);
});

test('checked unwrap refuses external lookalike and Proxy carriers rather than catching them',async()=>{
 const guest=await load('pub fnc make():Option<int>{return None;} pub fnc choose(Option<int> x):int{return '+match('x')+';}');
 const genuine=guest.make();
 assert.equal(guest.choose(genuine),42n);
 const forged=Object.freeze(Object.assign(Object.create(null),{kind:'None',value:null}));
 assert.throws(()=>guest.choose(forged),/untrusted Option unwrap carrier/);
 assert.throws(()=>guest.choose(new Proxy(genuine,{})),/untrusted Option unwrap carrier/);
 const other=await load('pub fnc make():Option<int>{return None;}');
 assert.throws(()=>guest.choose(other.make()),/untrusted Option unwrap carrier/);
});

test('explicit throws rows validate transitively and trap only its own operand',async()=>{
 const source='fnc fail():int throws(Error){throw! new Error("downstream");} fnc choose(Option<int> x):int throws(Error){return '+match('x').replace('-> 42','-> fail()')+';} pub fnc main():int throws(){val r=trap! choose(None);return r.is_err()?42:0;}';
 assert.equal((await load(source)).main(),42n);
 assert.throws(()=>compileProgramV2(source.replace('choose(Option<int> x):int throws(Error)','choose(Option<int> x):int throws()')),/E_EFFECT/);
 assert.throws(()=>compileProgramV2('fnc raw(Option<int> x):int{return x.unwrap();} pub fnc main():int throws(){return raw(None);}'),/E_EFFECT/);
 assert.throws(()=>compileProgramV2('pub fnc main():int throws(){return 1/0;}'),/E_EFFECT/);
 assert.throws(()=>compileProgramV2('pub fnc main():int throws(Unknown){return 42;}'),/error:/);
 const ir=compileToProgramIRV2(source);
 ir.functions[1].throws=[];
 assert.throws(()=>compileProgramIRV2(ir),/E_EFFECT/);
 const caught='pub fnc main():int throws(){try {throw! new Error("handled");} catch(e){return 42;}}';
 assert.equal((await load(caught)).main(),42n);
 const terminal='pub fnc main():int throws(){panic! new Error("terminal");}';
 const panic=await load(terminal);assert.throws(()=>panic.main(),e=>e.effect==='panic');
});
test('typed Err(e) can call private Error handler and rethrow the original object',async()=>{
 const source='fnc handle_error(Error e):int throws(){return 42;} fnc choose(Option<int> x):int throws(){return '+match('x').replace('Err()','Err(e)').replace('-> 42','-> handle_error(e)')+';} pub fnc main(bool present):int throws(){return choose(present?Some(7):None);}';
 const guest=await load(source);
 assert.equal(guest.main(true),7n);assert.equal(guest.main(false),42n);
 const rethrow=source.replace('handle_error(Error e):int throws(){return 42;}','handle_error(Error e):int throws(Error){throw! e;}').replaceAll('throws(){return choose','throws(Error){return choose').replace('choose(Option<int> x):int throws()','choose(Option<int> x):int throws(Error)');
 const raw=await load(rethrow);
 assert.throws(()=>raw.main(false),e=>e.name==='OptionUnwrapError'&&Object.isFrozen(e)&&!e.cause);
 assert.equal(raw.main(true),7n);
 assert.throws(()=>compileProgramV2(source.replace('fnc handle_error','pub fnc handle_error')),/E_ERROR_BINDING/);
 assert.throws(()=>compileProgramV2(source.replace('handle_error(e)','handle_error(n)')),/error:/);
 assert.throws(()=>compileProgramV2(source.replace('Error e','int e')),/error:/);
 const forged=compileToProgramIRV2(source);
 const err=forged.functions[1].body.arms[1];err.body.args[0].slot=99;
 assert.throws(()=>compileProgramIRV2(forged),/E_ERROR_BINDING/);
 const mixed='fnc handle_error(Error e):int{return 42;} pub fnc main():int{val r=trap Err(7);return r |> match<int> over on Ok(n)->n,on Err(e)->handle_error(e),end;}';
 assert.throws(()=>compileProgramV2(mixed),/E_ERROR_BINDING/);
});
