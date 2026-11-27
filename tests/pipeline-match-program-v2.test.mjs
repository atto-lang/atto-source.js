import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';

const load=async source=>import('data:text/javascript,'+encodeURIComponent(compileProgramV2(source)));
const program=expr=>`
  fnc increment(int n): int { return n + 1; }
  pub fnc choose(Result<int,int> result): int { return ${expr}; }
  pub fnc ok(): int { return choose(Ok(41)); }
  pub fnc err(): int { return choose(Err(0)); }
`;

test('brace and end match pipeline stages have identical checked IR',()=>{
  const standalone=program('increment(match<int> result over on Ok(value) -> value, on Err(error) -> 42, end)');
  const expected=compileToProgramIRV2(standalone);
  for(const type of ['', '<int>']){
    for(const [open,close] of [['{','}'],['','end']]){
      const stage=program('result |> match'+type+' over '+open+
        ' on Ok(value) -> value, on Err(error) -> 42, '+close+' |> increment');
      assert.deepEqual(compileToProgramIRV2(stage),expected);
    }
  }
});

test('actual ESM guest executes Result branches and chained stages',async()=>{
  const guest=await load(program('result |> match over { on Ok(value) -> value, on Err(error) -> 42, } |> increment'));
  assert.equal(guest.ok(),42n);
  assert.equal(guest.err(),43n);
  const scalar=await load('pub fnc main():int { return 1 |> match<int> over { on 1 -> 41, default -> 0, } |> match over on 41 -> 42, default -> 0, end; }');
  assert.equal(scalar.main(),42n);
});

test('invalid match stages are rejected before ESM emission',()=>{
  for(const expr of [
    'result |> match over {}',
    'result |> match result over { on Ok(v) -> v, on Err(e) -> 0, }',
    'result |> match over { on Ok(v) -> v, }',
    'result |> match over { on Ok(v) -> v, on Ok(w) -> w, }',
    'result |> match over { on Ok(v) -> v, on Err(e) -> true, }',
    'result |> match over { on Ok(v) -> v, on Err(e) -> 0, end',
    'result |> match over { on Ok(v) -> v,, on Err(e) -> 0, }',
    'result |> match over { on Ok(v) v, on Err(e) -> 0, }'
  ])assert.throws(()=>compileProgramV2(program(expr)),/error:/,expr);
});

test('explicit result type cannot silently become bool in ADT match',()=>{
  const source='pub fnc f(Result<int,int> result):bool { return result |> match<int> over { on Ok(v) -> true, on Err(e) -> false, }; }';
  assert.throws(()=>compileProgramV2(source),/explicit match<int> requires integer arm results/);
});

test('bare immediate await erases to checked integer identity in prefix and pipeline positions',async()=>{
  const program=expr=>'fnc identity(int x):int { return x; } pub fnc main():int { return '+expr+'; }';
  const plain=compileToProgramIRV2(program('identity(42)'));
  for(const expr of ['42 |> await |> identity','identity(await 42)','identity(42 |> await)']){
    assert.deepEqual(compileToProgramIRV2(program(expr)),plain);
    assert.equal((await load(program(expr))).main(),42n);
  }
  for(const expr of ['true |> await','42 |> await(7)','42 |> await<int>','Ok(42) |> await'])
    assert.throws(()=>compileProgramV2(program(expr)),/error:/,expr);
});

test('bounded integer membership executes actual compiled ESM and preserves one body',async()=>{
  const source=`fnc pick(int x):int {
    return match x over on 2 -> 42, in [1,2,3] -> 41, on _ -> 0 end;
  }
  pub fnc main():int { return pick(2); }
  pub fnc hit():int { return pick(3); }
  pub fnc miss():int { return pick(7); }`;
  const guest=await load(source);
  assert.equal(guest.main(),42n);
  assert.equal(guest.hit(),41n);
  assert.equal(guest.miss(),0n);
  const boundary=await load('pub fnc main():int { return -9223372036854775808 |> match over in [-9223372036854775808, 0] -> 42, on _ -> 0 end; }');
  assert.equal(boundary.main(),42n);
  const lazy=await load('pub fnc main(int x):int { return match x over in [1,2] -> 42, on _ -> 1 / (x - x) end; }');
  assert.equal(lazy.main(2n),42n);
});
test('static int type lists use checked scalar exhaustiveness',async()=>{
  const guest=await load('pub fnc main():int { return 7 |> match over on 42 -> 0, is in [int,bool] -> 42 end; }');
  assert.equal(guest.main(),42n);
});
test('membership syntax rejects unsupported and invalid inputs before emission',()=>{
  for(const arms of [
    'in [] -> 42, on _ -> 0','in [2,2] -> 42, on _ -> 0',
    'on 2 -> 42, in [2] -> 0, on _ -> 0','in [1,2] -> 42',
    'in [1,true] -> 42, on _ -> 0','in values -> 42, on _ -> 0',
    'in [1,2] when false -> 42, on _ -> 0',
    'is in [] -> 42','is in [int,int] -> 42',
    'is in [int,String,string] -> 42','is in [int,42] -> 42',
    'is in [bool,string] -> 42','is in [int,bool] -> 42, on _ -> 0'
  ])assert.throws(()=>compileProgramV2('pub fnc main():int { return match 2 over '+arms+' end; }'),/error:/,arms);
  assert.throws(()=>compileProgramV2('pub fnc main():int { return match true over is in [int,bool] -> 42 end; }'),/error:/);
});

test('compile-time Pattern declarations erase into ordinary checked match IR',async()=>{
  const prefix='const Pattern p1 = on 5; const Pattern p2 = is Int; const Pattern p3 = in [6,7]; const Pattern[] z = [p1,p3]; const Pattern[] type_patterns = [is int,is bool]; ';
  const src=prefix+'pub fnc main(int x):int { return match x over on p1 -> 5, in z -> 42, is in type_patterns -> 0 end; }';
  const direct='pub fnc main(int x):int { return match x over on 5 -> 5, in [6,7] -> 42, is in [int,bool] -> 0 end; }';
  assert.deepEqual(compileToProgramIRV2(src),compileToProgramIRV2(direct));
  const g=await load(src);
  assert.equal(g.main(5n),5n);
  assert.equal(g.main(6n),42n);
  assert.equal(g.main(7n),42n);
  assert.equal(g.main(8n),0n);
  assert.equal((await load(prefix+'pub fnc main():int { return 7 |> match over on p2 -> 42 end; }')).main(),42n);
  assert.equal((await load('pub fnc main():int { return match 3 over in [on 1,in [2,3]] -> 42,on _ -> 0 end; }')).main(),42n);
  assert.equal((await load('const Pattern[] type_patterns = [is int,is bool]; pub fnc main():int { return match 3 over in type_patterns -> 42 end; }')).main(),42n);
});
test('compile-time Pattern constants cannot escape or be silently widened',()=>{
  const invalid=[
    'const Pattern p = on 5; pub fnc main():int { return p; }',
    'const Pattern p = on 5; pub fnc main(int p):int { return match p over on p -> 42,on _ -> 0 end; }',
    'const Pattern p = on q; const Pattern q = on p; pub fnc main():int { return 42; }',
    'const Pattern[] z = [on 1,2]; pub fnc main():int { return 42; }',
    'const Pattern[] z = [is int,on 1]; pub fnc main():int { return match 1 over is in z -> 42 end; }',
    'const Pattern[] z = [on 1,on 1]; pub fnc main():int { return 42; }',
    'const Pattern[] z = [is int,is Int]; pub fnc main():int { return 42; }',
    'const Pattern p = on 1; pub fnc main():int { return match 1 over in p -> 42,on _ -> 0 end; }',
    'const Pattern[] z = [on 1]; pub fnc main():int { return match 1 over on z -> 42,on _ -> 0 end; }',
    'const Pattern p = on 1; fnc use(Pattern x):int { return 42; } pub fnc main():int { return use(p); }',
    'pub fnc main(int n):int { const Pattern p = on n; return 42; }',
    'const Pattern p = on true; pub fnc main():int { return 42; }',
    'const Pattern p = is Foo; pub fnc main():int { return 42; }',
    'const Pattern[] z = [on 1,on 2]; pub fnc main():int { return match 2 over in z -> 42,on 2 -> 0,on _ -> 0 end; }',
    'const Pattern[] z = ['+Array.from({length:65},(_,i)=>'on '+i).join(',')+']; pub fnc main():int { return 42; }'
  ];
  for(const src of invalid)assert.throws(()=>compileProgramV2(src),/error:/,src);
});
