import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  compileProgramV2,compileToProgramIRV2,compileProgramIRV2
} from '../src/program-v2.mjs';

// 50 distinct source programs: the post-typechecking final ESM, not a
// hand-written JS approximation, must parse and produce expected observations.
// These are executable JS probes, not independent Java/LLVM guest receipts.
const probes=[];
const push=(id,source,expected,kind='value')=>probes.push({
  id,source,expected,kind
});

// Ten signed-i64 edges, including *intermediate* and zero-divisor traps.
const numeric=[
  ['max-plus-zero','(9223372036854775807 + 0)',(1n<<63n)-1n],
  ['min-plus-zero','(-9223372036854775808 + 0)',-(1n<<63n)],
  ['max-plus-one','(9223372036854775807 + 1)','ORES_I64_OVERFLOW'],
  ['min-minus-one','(-9223372036854775808 - 1)','ORES_I64_OVERFLOW'],
  ['min-times-minus-one','(-9223372036854775808 * -1)','ORES_I64_OVERFLOW'],
  ['zero-times-max','(0 * 9223372036854775807)',0n],
  ['over53-add','(9007199254740993 + 9007199254740993)',18014398509481986n],
  ['near-square','(3037000499 * 3037000499)',9223372030926249001n],
  ['square-overflow','(3037000500 * 3037000500)','ORES_I64_OVERFLOW'],
  ['remainder-zero','(0 % 0)','ORES_I64_DIVISION_BY_ZERO']
];
for(const [id,expr,expected] of numeric)
  push('integer-'+id,'pub fnc main():int{return '+expr+';}',expected,
    typeof expected==='string'?'trap':'value');

// Ten precedence / associativity identities over varying scalar operands.
for(let i=1;i<=10;i++){
  const n=String(i);
  const expressions=[
    ['(-('+n+'+3))+('+n+'+3)',0n],
    ['('+n+'+2)*3-'+n+'*3',6n],
    [n+'*10-('+n+'+1)*9+9',BigInt(i)],
    ['('+n+'+40)-('+n+'-2)',42n],
    ['('+n+'+2)*('+n+'+3)-('+n+'*'+n+'+5*'+n+')',6n],
    ['(('+n+'+1)*2)-'+n+'*2',2n],
    [n+'*'+n+'-'+n+'*('+n+'-1)',BigInt(i)],
    [n+'+2*3-'+n,6n],
    ['(('+n+'-1)+('+n+'+1))-2*'+n,0n],
    ['('+n+'*0)+42',42n]
  ];
  const [expr,expected]=expressions[i-1];
  push('precedence-'+i,'pub fnc main():int{return '+expr+';}',expected);
}

// Ten public caller paths with positional-to-formal named argument
// reordering. A naive emission in call-site order produces a wrong result.
for(let i=1;i<=10;i++){
  const source='fnc digits(int a,int b,int c):int{return a*100+b*10+c;} '+
    'pub fnc main():int{return digits(c:2,b:4,a:0)+'+String(i)+'-'+String(i)+';} '+
    'pub fnc mixed(int x):int{return digits(c:2,a:0,b:x);}';
  push('named-call-'+i,source,42n,'named');
}

// Five conditional statements and five scalar matches with cold branches
// that would trap if the emitter evaluated unselected branches eagerly.
for(let i=1;i<=5;i++){
  const x=String(i);
  push('conditional-true-'+i,
    'pub fnc main():int{if '+x+' > 0 then return 42; '+
    'else return 1%0; fi}',42n);
  push('match-selected-'+i,
    'pub fnc main():int{return match '+x+' over on '+x+
    ' -> {42;} on _ -> {1%0;} end;}',42n);
}

// Ten generator-only helper consumers. Before helper discovery was expanded
// beyond ordinary functions/methods these produced ESM with missing helpers.
const yielded=[
  ['symbol-equal','#ready eq #ready ? 42 : 0'],
  ['symbol-not-equal','#ready neq #error ? 42 : 0'],
  ['symbol-cold-true','#ready eq #error ? 0 : 42'],
  ['symbol-cold-false','#ready neq #ready ? 0 : 42'],
  ['option-some','Option.unwrap_or(Option.some(42),0)'],
  ['option-none','Option.unwrap_or(Option.none(),42)'],
  ['result-ok','Result.unwrap_or(Result.ok(42),0)'],
  ['result-error','Result.unwrap_err_or(Result.err(42),0)'],
  ['result-default','Result.unwrap_or(Result.err(0),42)'],
  ['option-predicate','Option.is_some(Option.some(1)) ? 42 : 0']
];
for(const [id,expr] of yielded)
  push('generator-'+id,
    'pub gen* values():Iterator<int>{yield '+expr+';return;}',42n,
    'generator');

test('50-case adversarial corpus is distinct and covers five families',()=>{
  assert.equal(probes.length,50);
  assert.equal(new Set(probes.map(p=>p.id)).size,50);
  assert.equal(new Set(probes.map(p=>p.source)).size,50);
  assert.equal(probes.filter(p=>p.kind==='generator').length,10);
  assert.equal(probes.filter(p=>p.kind==='trap').length,5);
});

for(const p of probes){
  test('final emitted ESM adversarial / '+p.id,async()=>{
    const esm=compileProgramV2(p.source);
    const ir=JSON.parse(JSON.stringify(compileToProgramIRV2(p.source)));
    assert.equal(compileProgramIRV2(ir),esm,p.id+' typed IR output identity');
    const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{
      input:esm,encoding:'utf8',timeout:10000,maxBuffer:1024*1024
    });
    assert.equal(syntax.error,undefined,p.id+' Node syntax-check error');
    assert.equal(syntax.status,0,p.id+' Node ESM syntax: '+syntax.stderr);
    const mod=await import('data:text/javascript;charset=utf-8,'+
      encodeURIComponent(esm)+'#adversarial-'+p.id);
    const observe=()=>{
      if(p.kind==='generator'){
        const iter=mod.values();
        const first=iter.next();
        assert.deepEqual(first,{value:p.expected,done:false});
        assert.deepEqual(iter.next(),{value:undefined,done:true});
        return p.expected;
      }
      if(p.kind==='named'){
        assert.equal(mod.mixed(4n),42n);
        assert.throws(()=>mod.mixed(4),/BigInt required/);
      }
      return mod.main();
    };
    if(p.kind==='trap')
      assert.throws(observe,e=>e instanceof RangeError&&
        e.message.startsWith(p.expected+':'));
    else assert.equal(observe(),p.expected);
  });
}
