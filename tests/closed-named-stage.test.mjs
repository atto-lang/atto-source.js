import test from 'node:test';
import assert from 'node:assert/strict';
import {emitNamedStage,validateNamedStageBody,NAMED_STAGE_DEPTH} from '../src/closed-named-stage.mjs';

const integer=n=>({kind:'int',value:String(n)});
const arg={kind:'stageArg'};
const bin=(op,left,right)=>({kind:'binary',op,left,right});
const self=inner=>({kind:'stageSelf',inner});
const match=arms=>({kind:'match',subject:arg,arms:arms.map(([value,body])=>({value:value===null?null:String(value),body}))});
const fib=match([[0,integer(0)],[1,integer(1)],[null,bin('+',self(bin('-',arg,integer(2))),self(bin('-',arg,integer(1))) )]]);
const count=match([[0,integer(0)],[null,bin('+',self(bin('-',arg,integer(1))),integer(1))]]);
const runtime=`const _arith=(code,message)=>Object.assign(new RangeError(message),{code});
const _check=v=>{if(typeof v!=='bigint')throw new TypeError('int required');if(v<-(1n<<63n)||v>(1n<<63n)-1n)throw _arith('integer_overflow','overflow');return v;};`;
async function guest(body){
  const code=runtime+'export function run(next){return '+emitNamedStage(body,'next()')+';}';
  return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).run;
}
test('emitted recursive ESM computes Fibonacci and observes upstream exactly once',async()=>{
  const run=await guest(fib);let calls=0;
  for(const [n,want] of [[0n,0n],[1n,1n],[10n,55n],[20n,6765n]])assert.equal(run(()=>{calls++;return n;}),want);
  assert.equal(calls,4);
  assert.match(emitNamedStage(fib,'10n'),/function _self/);
});
test('depth quota, success restoration, and exact stack error',async()=>{
  const run=await guest(count);
  assert.equal(run(()=>BigInt(NAMED_STAGE_DEPTH)),1024n);
  assert.throws(()=>run(()=>1025n),{message:'E_STACK: named stage logical depth exhausted'});
  for(let i=0;i<3;i++)assert.equal(run(()=>600n),600n);
});
test('checked full-width value, lazy arms, overflow and division',async()=>{
  const run=await guest(match([[0,integer(9223372036854775807n)],[null,bin('+',self(integer(0)),integer(1))]]));
  assert.equal(run(()=>0n),9223372036854775807n);
  assert.throws(()=>run(()=>1n),{code:'integer_overflow'});
  const divide=await guest(bin('/',arg,integer(0)));
  assert.throws(()=>divide(()=>42n),{code:'division_by_zero'});
});
test('reject escaped names, arbitrary calls, bad literals and forged metadata',()=>{
  for(const body of [{kind:'param',index:0},{kind:'call',target:0,args:[]},{kind:'stageSelf',inner:arg,target:1},
    {kind:'int',value:'9223372036854775808'},{kind:'int',value:'1n;throw 1'},{kind:'binary',op:'=',left:arg,right:arg},
    match([[0,integer(1)]]),match([[null,integer(0)],[1,integer(2)]]),match([[0,arg],[0,arg],[null,arg]])])
    assert.throws(()=>validateNamedStageBody(body),/E_NAMED_STAGE_PROFILE/);
  const getter={kind:'int',get value(){throw Error('getter invoked');}};
  assert.throws(()=>validateNamedStageBody(getter),/non-data body field/);
});
test('body validation counts repeated subtrees and rejects cycles',()=>{
  let large=arg;
  for(let i=0;i<13;i++)large=bin('+',large,large);
  assert.throws(()=>validateNamedStageBody(large),/body budget/);
  const cycle={kind:'stageSelf'};cycle.inner=cycle;
  assert.throws(()=>validateNamedStageBody(cycle),/body budget/);
  const original=integer(42),copy=validateNamedStageBody(original);original.value='0';assert.equal(copy.value,'42');
});
