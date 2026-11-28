import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';
const pre='fnc combine(int x,int y):int{return x*10+y;} ';
const src=body=>pre+'pub fnc main():int{'+body+'}';
async function execute(source){
  const js=compileProgramV2(source);
  const module=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));
  return module.main();
}
test('immutable stored Tuple and Record factories bind fixed integer slots',async()=>{
  for(const [body,want] of [
    ['const t=Tuple.of(4,2);return combine.apply(t);',42n],
    ['const r=Record.of(y:=2,x:=4);return combine.apply(r);',42n],
    ['val Record r=Record.of(y:=4,x:=2,);return combine.apply(r);',24n],
    ['const Tuple t=Tuple.of(4,2);return combine.apply(t)+combine.apply(t);',84n],
    ['const x=4;const r=Record.of(y:=2,x:=x);return combine.apply(r);',42n],
  ])assert.equal(await execute(src(body)),want,body);
  assert.equal(await execute('fnc f():int{return 42;} pub fnc main():int{const t=Tuple.of();const r=Record.of();return f.apply(t)+f.apply(r);}'),84n);
});
test('initializers are eagerly evaluated once before application and in source order',async()=>{
  const source='fnc value():int{return 4;} '+src('const r=Record.of(y:=2,x:=value());return combine.apply(r)+combine.apply(r);');
  assert.equal(await execute(source),84n);
  const ir=compileToProgramIRV2(source);
  const target=ir.functions.findIndex(f=>f.name==='value');
  assert.ok(target>=0);
  function count(x){return !x||typeof x!=='object'?0:Number(x.kind==='call'&&x.target===target)+Object.values(x).reduce((n,v)=>n+count(v),0);}
  assert.equal(count(ir.functions.find(f=>f.name==='main')),1,'initializer not duplicated by reuse');
  const fail='fnc divzero():int{return 1/0;} fnc overflow():int{return 9223372036854775807+1;} '+src('const r=Record.of(y:=divzero(),x:=overflow());return 0;');
  await assert.rejects(()=>execute(fail),/ORES_I64_DIVISION_BY_ZERO/);
});
test('escape, collision, wrong shape and shadowed factory remain rejected',()=>{
  for(const body of [
    'const r=Record.of(y:=2,y:=4);return 0;',
    'const r=Record.of(y:2,x:4);return 0;',
    'const r=Record.of(y : =2,x:=4);return 0;',
    'const r=Record.of(y:=true,x:=4);return combine.apply(r);',
    'const r=Record.of(z:=2,x:=4);return combine.apply(r);',
    'const r=Record.of(x:=4);return combine.apply(r);',
    'const t=Tuple.of(4,2,3);return combine.apply(t);',
    'const Tuple t=Record.of(x:=4,y:=2);return 0;',
    'const t=Tuple.of(4,2);return t;',
    'const t=Tuple.of(4,2);return combine.call(t);',
    'const t=Tuple.of(4,2);const t=5;return 0;',
    'const Record=1;const r=Record.of(x:=4,y:=2);return combine.apply(r);',
    'const combine=1;const r=Record.of(x:=4,y:=2);return combine.apply(r);',
  ])assert.throws(()=>compileProgramV2(src(body)),undefined,body);
});
