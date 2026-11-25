import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker as compile,TranspileError} from '../src/transpile-worker.mjs';
const main=body=>'pub fnc main():int{'+body+'}';
async function execute(source){
  const {module_source}=compile(source);
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(module_source));
  return (await (await mod.create_tenant({tenant:'test',generation:1})).on_message()).value;
}
test('Java canonical worker operators preserve existing inline-task semantics',async()=>{
  for(const [body,want] of [["^ 12 ^^ 10;","6"],["return 1 | 2 ^^ 3 & 2;","1"],["^ -1 >>> 1;","9223372036854775807"],["return 1 <<< 63;","-9223372036854775808"],["^ (1 <<< 63) >>> 63;","1"],["^ 1 + 2 <<< 3;","24"],["^ 1 <<< 2 + 3;","32"],["^ -(2 + 5) * (3 - 1);","-14"],["return sync task<int> { ^ 12 ^^ 10; };","6"],["do sync task<void> { ^; } ^ 42;","42"],["^ 1 + sync task<int>{ ^ 40 + sync task {return 1;};};","42"],["^ sync task<int>{return -9223372036854775808;};","-9223372036854775808"]])assert.equal(await execute(main(body)),want,body);
  assert.equal(await execute("define actor Counter as let int total=0; receive(ActorMail<int> mail):void{self.total=self.total+mail.value;stdio.println(self.total);^;} end pub fnc main():int{val counter=spawn Counter();^0;}"),'0');
});
test('invalid worker operators and generic task types remain fail-closed',async()=>{
  for(const [body,code] of [["return 12 ^ 10;","E_UNSUPPORTED_SYNTAX"],["^ ^ 5;","E_UNSUPPORTED_EXPRESSION"],["return 8 << 2;","E_IO_UNSUPPORTED"],["return 8 >> 2;","E_IO_UNSUPPORTED"],["return 1 <<< 64;","E_SHIFT_DISTANCE"],["return 1 >>> -1;","E_SHIFT_DISTANCE"],["return true ^^ false;","E_UNSUPPORTED_EXPRESSION"],["do sync task<Future<int>> {}; return 0;","E_TASK_RETURN_TYPE"],["return sync task<Future<int>> {return 42;};","E_TASK_UNSUPPORTED"],["return 2 % 3;","E_UNSUPPORTED_TOKEN"],["return 1 < < < 3;","E_UNSUPPORTED_SYNTAX"]])assert.throws(()=>compile(main(body)),e=>e instanceof TranspileError&&e.code===code,body);
  for(const expr of ['1 <<< (63+1)','1 >>> (0-1)'])await assert.rejects(execute(main('return '+expr+';')),/E_GUEST_SHIFT_DISTANCE/);
});
test('all supported line separators end comments before caret return',async()=>{
  for(const end of ['\r','\n','\r\n','\u0085','\u2028','\u2029'])assert.equal(await execute(main('// return 0;'+end+'^42;')),'42');
});
test('192 deterministic signed-i64 worker XOR/shift guests',async()=>{
  let seed=0x53747a21;
  const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const signed=()=>BigInt.asIntN(64,(BigInt(next())<<32n)|BigInt(next()));
  for(let i=0;i<64;i++){
    const a=signed(),b=signed(),n=BigInt(next()&63);
    for(const [expr,expected] of [[`(${a}) ^^ (${b})`,a^b],[`(${a}) <<< (${n})`,BigInt.asIntN(64,a<<n)],[`(${a}) >>> (${n})`,BigInt.asIntN(64,BigInt.asUintN(64,a)>>n)]])
      assert.equal(await execute(main('^ '+expr+';')),String(expected),expr);
  }
});
