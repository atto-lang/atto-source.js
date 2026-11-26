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
 for(const expr of [match('x').replace('unwrap()','unwrap(1)'),match('x').replace('x.unwrap','y.unwrap'),match('x').replace('Err()','Err(e)'),match('x').replace('-> 42','-> true'),match('x').replace('on Err(): int -> 42,',''),match('x').replace('match<int>','match<bool>')])
  assert.throws(()=>compileProgramV2(optionSource(expr)),/error:/,expr);
 for(const mutate of [
  ir=>ir.functions[0].body.subject.inner.name='Result.unwrap',
  ir=>ir.functions[0].body.adt='result<int,int>',
  ir=>ir.functions[0].body.arms[1].slot=17,
  ir=>ir.functions[0].body.subject.inner.args.push({kind:'int',value:'1'}),
  ir=>ir.functions[0].body.arms.pop()
 ]){
  const ir=compileToProgramIRV2(optionSource());mutate(ir);
  assert.throws(()=>compileProgramIRV2(ir),/error: program IR:/);
 }
});
