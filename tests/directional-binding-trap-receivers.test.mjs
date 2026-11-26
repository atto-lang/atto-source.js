import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';
const header='fnc increment(int n):int{return n+1;} fnc divide(int a,int b):int{return a/b;} ';
const program=body=>header+'pub fnc main():int{'+body+'}';
const load=async body=>import('data:text/javascript,'+encodeURIComponent(compileProgramV2(program(body))));
test('directional scalar declaration sinks match ordinary binding IR and execute',async()=>{
  const expected=compileToProgramIRV2(program('val int n=41 |> increment;return n;'));
  for(const body of ['val int n << 41 |> increment;return n;','41 |> increment >> val int n;return n;','41 |> increment >> val n;return n;']){
    assert.deepEqual(compileToProgramIRV2(program(body)),expected);
    assert.equal((await load(body)).main(),42n);
  }
  for(const body of ['const int n << 42 |> if is int then 30 else 20 fi;return n;','42 |> if > 10 then 30 else 20 fi >> const int n;return n;'])
    assert.equal((await load(body)).main(),30n);
});
test('trapped call protects callable failure but not upstream failure',async()=>{
  assert.equal((await load('42 |> trap! divide(0) >> val r;return r.is_err() ? 42 : 0;')).main(),42n);
  assert.equal((await load('val r << 42 |> trap! divide(2);return r.unwrap();')).main(),21n);
  const upstream=await load('(1/0) |> trap! divide(2) >> val r;return r.is_err() ? 42 : 0;');
  assert.throws(()=>upstream.main(),/DIVISION_BY_ZERO/);
});
test('directional binding and trap reject ambiguous or unsupported forms',()=>{
  for(const body of ['42 |> trap! >> val r;return 0;','42 |> ref! >> val r;return 0;','42 >> let int n;return n;','42 >> const int n;return true;','41 |> increment >> const int n;return n;','true >> val int n;return n;','42 >> val int n;42 >> val int n;return n;','42 >> n;return 0;','42 > > val n;return n;'])
    assert.throws(()=>compileProgramV2(program(body)),/error:/,body);
});
test('triple-angle shift is not a declaration sink',async()=>{
  assert.equal((await load('val int n << 21 <<< 1;return n;')).main(),42n);
  assert.equal((await load('84 >>> 1 >> val int n;return n;')).main(),42n);
});
