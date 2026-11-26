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
