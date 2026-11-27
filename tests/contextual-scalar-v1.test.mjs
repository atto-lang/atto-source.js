import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';
const source=(body,context='int factor',expr='factor * value') =>
  'define class Scale as pub static fnc apply::('+context+')(int value) -> int { return '+expr+'; } end fnc main() -> int { '+body+' }';
const multi=(body)=>source(body,'int factor, int offset','factor * value + offset');
test('execute actual compiled contextual ESM guests',async()=>{
  const cases=[
    [source('return Scale::(6).apply(7);'),42n],
    [source('const x = Scale::(6); const y = x; const z = y; return z.apply(7);'),42n],
    [source('const x = Scale::(2); const y = Scale::(3); return x.apply(4) + y.apply(4);'),20n],
    [source('let n = 3; const x = Scale::(n); n = 9; const a = x.apply(4); const b = x.apply(5); return a + b + Scale::(2).apply(7);'),41n],
    [source('let n = 3; const x = Scale::(n + 1); n = 9; return x.apply(n) + Scale::(n - 7).apply(3);'),42n],
    [multi('let n = 3; const x = Scale::(n, n + 1); n = 9; return x.apply(5) + Scale::(2, 1).apply(7);'),34n],
    [multi('const x = Scale::(2, 3); const y = Scale::(4, 5); return x.apply(7) + y.apply(7);'),50n],
  ];
  for(const [s,expected] of cases){
    const ir=compileToProgramIRV2(s);
    assert.equal((ir.classes??[]).length,0);
    const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(compileProgramV2(s)));
    assert.deepEqual(Object.keys(mod),['main']);
    assert.equal(mod.main(),expected);
  }
});
test('malformed or unauthorized contextual inputs fail before ESM emission',()=>{
  for(const s of [
    source('return Scale::(true).apply(7);'),
    source('return Scale::(6).apply(true);'),
    source('return Scale.apply(7);'),
    source('return Scale::(6).other(7);'),
    source('return Scale::(6).apply([7);'),
    source('return Scale::(6).apply(7]);'),
    source('const x = Scale::(2); x = 9; return x.apply(3);'),
    source('const x = Scale::(2); const x = Scale::(3); return x.apply(3);'),
    source('const x = Scale::(2); return x;'),
    source('const x = Scale::(2); const y = x; y = 3; return x.apply(7);'),
    source('const x = Scale::(2); const y = x; return y;'),
    source('const x = Scale::(2); let y = x; return y.apply(7);'),
    source('return _atto_context_esm_member(2,3);'),
    multi('return Scale::(2,).apply(3);'),
    multi('return Scale::(2).apply(3);'),
    multi('return Scale::(factor=2,offset=1).apply(3);'),
    source('return Scale::(2).apply(3);','int factor, int factor'),
  ]) assert.throws(()=>compileProgramV2(s),undefined,s);
});
test('ordinary source remains on existing frontend',async()=>{
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(compileProgramV2('pub fnc main()->int{return 42;}')));
  assert.equal(mod.main(),42n);
});

test('legacy parenthesized callable body keeps explicit export rules',async()=>{
  const pub=compileProgramV2('pub fnc main() -> int :: (6 * 7) end');
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(pub));
  assert.equal(mod.main(),42n);
  const internal=compileProgramV2('fnc main() -> int :: (42) end');
  const hidden=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(internal));
  assert.equal(hidden.main,undefined);
  assert.throws(()=>compileProgramV2('pub fnc main() -> int :: (true) end'));
  assert.throws(()=>compileProgramV2('pub fnc main() -> int :: (42 end'));
});

test('stored named context slots map by schema while evaluating in source order',async()=>{
 for(const [src,want] of [
 [multi('const x = Scale::(offset=7,factor=5); return x.apply(7);'),42n],
 [multi('let n = 3; const x = Scale::(offset=n+1,factor=n); set n = 9; return x.apply(5) + Scale::(2,1).apply(7);'),34n],
 [source('let n = 6; const x = Scale::(factor=n); set n = 1; return x.apply(7);'),42n]
 ]){
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(compileProgramV2(src)));
  assert.equal(mod.main(),want);
 }
 for(const body of ['const x = Scale::(offset=7,offset=5); return x.apply(7);','const x = Scale::(offset=7,5); return x.apply(7);','const x = Scale::(unknown=7,factor=5); return x.apply(7);','const x = Scale::(offset=7); return x.apply(7);','const x = Scale::(offset=true,factor=5); return x.apply(7);','const x = Scale::(offset=7,factor=5); set x = 2; return x.apply(7);'])
  assert.throws(()=>compileProgramV2(multi(body)),undefined,body);
});
