import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileFunctionalPipelineSource as compile} from '../src/functional-pipelines.mjs';

const program = expr => `pub fnc main(): int { return ${expr}; }`;
const tuple = items => `(${items.join(',')}${items.length===1?',':''})`;
async function guest(js,callback=main=>main()) {
  const dir=await mkdtemp(join(tmpdir(),'atto-tuple-proof-'));
  try {
    const file=join(dir,'guest.mjs');await writeFile(file,js);
    return await callback((await import(pathToFileURL(file).href)).main);
  } finally {await rm(dir,{recursive:true,force:true});}
}

test('compiled guest agrees with independent weighted oracle for every discard mask through arity eight',async()=>{
  let count=0;
  for(let n=0;n<=8;n++)for(let mask=0;mask<(1<<n);mask++){
    const values=Array.from({length:n},(_,i)=>3*i-7);
    const names=values.map((_,i)=>mask&(1<<i)?'_':`a${i}`);
    const body=['19',...names.flatMap((name,i)=>name==='_'?[]:[`${i+2}*${name}`])].join('+');
    const expected=values.reduce((acc,value,i)=>mask&(1<<i)?acc:acc+BigInt(value*(i+2)),19n);
    const source=program(`${tuple(values.map(String))} |> |${tuple(names)}| -> ${body}`);
    const js=compile(source);
    assert.match(js,/\(\(tuple_root_0\)=>\{/);
    assert.equal(await guest(js),expected,source);
    count++;
  }
  assert.equal(count,511);
});

test('typed leaves, grouping, lexical shadowing, nested stages and pipeline continuation',async()=>{
  const cases=[
    ['(5,3,5) |> |(a:int,b:int,c:int)| -> a+b+c',13n],
    ['((5,8) |> |(a,b)| -> a+b) + 1',14n],
    ['(5,8) |> |(a,b)| -> ((a,2) |> |(a,c)| -> a*c)+b',18n],
    ['((5,8) |> |(a,b)| -> a+b, 2) |> |(a,b)| -> a*b',26n],
    ['() |> |()| -> 7',7n],
    ['(9,) |> |(a,)| -> a',9n],
  ];
  for(const [expr,expected] of cases)assert.equal(await guest(compile(program(expr))),expected,expr);
  assert.equal(await guest(compile('fnc double(int v): int { return v*2; } '+program('(5,8) |> |(a,b)| -> a+b |> double'))),26n);
  assert.equal(await guest(compile('pub fnc main(): int { val a=19; return ((5,8) |> |(a,b)| -> a+b)+a; }')),32n);
});

test('ordinary forward and reverse scalar pipes retain existing behavior',async()=>{
  for(const expr of ['5 |> double','double <| 5']){
    assert.equal(await guest(compile('fnc double(int v): int { return v*2; } '+program(expr))),10n);
  }
});

test('discard still evaluates a trapping element; all input evaluations precede the body',async()=>{
  for(const expr of [
    '(9223372036854775807+1,8) |> |(_,b)| -> b',
    '(5,9223372036854775807+1) |> |(a,_)| -> a',
    '(9223372036854775807+1,) |> |(_,)| -> 0',
  ]) await assert.rejects(guest(compile(program(expr))),/E_OVERFLOW/);
  const source='fnc first(): int { return 5; } fnc second(): int { return 8; } '+program('(first(),second()) |> |(_,b)| -> b+b');
  const js=compile(source);
  assert.equal((js.match(/f_first\(\)/g)||[]).length,2); // one declaration, one call
  assert.equal((js.match(/f_second\(\)/g)||[]).length,2);
  assert.match(js,/\}\)\(\[f_first\(\),f_second\(\)\]\)/);
  assert.equal(await guest(js),16n);
});

test('wrong shapes, arities, duplicate bindings, unknowns, unsupported profiles never emit code',()=>{
  const cases=[
    ['1 |> |(a,b)| -> a+b','E_PATTERN_SHAPE'],
    ['(1,2,3) |> |(a,b)| -> a+b','E_ARITY'],
    ['(1,) |> |()| -> 0','E_ARITY'],
    ['(1,) |> |(a)| -> a','E_PATTERN'],
    ['(1,2) |> |(a,a)| -> a','E_DUP_PARAM'],
    ['(1,2) |> |(a,_)| -> _','E_SYMBOL'],
    ['(1,2) |> |(arguments,b)| -> b','E_DUP_PARAM'],
    ['(1,2) |> |(self,b)| -> b','E_DUP_PARAM'],
    ['(1,2) |> |(_:int,b)| -> b','E_PATTERN'],
    ['(1,2) |> |(a:bool,b)| -> b','E_PARSE'],
    ['((1,2),3) |> |(a,b)| -> b','E_UNSUPPORTED_TUPLE_VALUE'],
    ['(1,2)','E_UNSUPPORTED_TUPLE_VALUE'],
    ['(1,2) |> |a,b| -> a+b','E_PARSE'],
    ['(1,2) |> |(a,b) as t| -> a+b','E_PARSE'],
  ];
  for(const [expr,code] of cases)assert.throws(()=>compile(program(expr)),e=>e.code===code,expr);
  assert.throws(()=>compile('fnc sum(int a,int b): int { return a+b; } '+program('(1,2) |> sum')),e=>e.code==='E_ARITY');
  assert.throws(()=>compile('fnc sum(int a): int { return a; } '+program('(1,2) |> sum')),e=>e.code==='E_UNSUPPORTED_TUPLE_VALUE');
});

test('explicit stdout capability remains gated, including a tuple stage',async()=>{
  const source='pub fnc main(): int { stdio.println((5,8) |> |(a,b)| -> a+b); return 7; }';
  assert.throws(()=>compile(source),e=>e.code==='E_PERMISSION');
  const js=compile(source,{allowStdio:true});
  await assert.rejects(guest(js),/E_PERMISSION/);
  const seen=[];assert.equal(await guest(js,main=>main(x=>seen.push(x))),7n);
  assert.deepEqual(seen,[13n]);
});

test('independent oracle detects wrong index, lost projection, flattened root, swapped evaluation',async()=>{
  const js=compile(program('(5,8) |> |(a,b)| -> 2*a+3*b'));
  assert.equal(await guest(js),34n);
  for(const mutant of [
    js.replace('tuple_root_0[0]','tuple_root_0[1]'),
    js.replace('const tuple_slot_0_1=tuple_root_0[1];',''),
    js.replace('})([checked(5n),checked(8n)])','})(checked(5n),checked(8n))'),
    js.replace('[checked(5n),checked(8n)]','[checked(8n),checked(5n)]'),
  ]){
    assert.notEqual(mutant,js);
    let result;try{result=await guest(mutant);}catch{result='rejected';}
    assert.notEqual(result,34n);
  }
});
