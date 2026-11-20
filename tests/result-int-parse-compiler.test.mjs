import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker as transpile} from '../src/transpile-worker.mjs';

function source(text, err='0', positive='value') {
  return 'pub fnc parse_id(string text): Result<int, Error> {\n'+
    ' val parsed = int.parse(text)?; return Ok(parsed);\n}\n'+
    'pub fnc main(): int { return match parse_id('+JSON.stringify(text)+') over\n'+
    ' on Ok(value) -> '+positive+', on Err() -> '+err+' end; }\n';
}
async function execute(src) {
  const {module_source,guest_abi}=transpile(src);
  assert.equal(guest_abi,'atto.js.browser.result-int-parse.v1');
  const uri='data:text/javascript;charset=utf-8,'+encodeURIComponent(module_source);
  const compiled=await import(uri);
  const guest=await compiled.create_tenant({tenant:'a',generation:1});
  const out=await guest.on_message();
  await assert.rejects(guest.on_message(),/E_MAIN_ALREADY_CALLED/);
  return out.value;
}
test('source-compiled exact parse_id Result + ? + match',async()=>{
  assert.equal(await execute(source('42')),'42');
  assert.equal(await execute(source('+42')),'42');
  assert.equal(await execute(source('00042')),'42');
  assert.equal(await execute(source('-9223372036854775808')),'-9223372036854775808');
  assert.equal(await execute(source('9223372036854775807')),'9223372036854775807');
});
test('source-compiled Err branch, malformed and bounded inputs',async()=>{
  for(const bad of ['', '+','-', ' 42','42 ','٤٢','4_2','9223372036854775808',
    '-9223372036854775809', '4\0'+'2', '0'.repeat(1025)]) {
    const err=await execute(source(bad,'7'));
    assert.equal(err,'7');
  }
  assert.equal(await execute(source('0'.repeat(1024))),'0');
});
test('reject ill-typed, nonexhaustive and unsupported effects without JS artifact',()=>{
  const base=source('42');
  for(const [src,code] of [
    [base.replace('on Err() -> 0','on Err() -> 0, on Err() -> 1'),'E_MATCH_DUPLICATE'],
    [base.replace(', on Err() -> 0',''),'E_MATCH_NONEXHAUSTIVE'],
    [base.replace('int.parse(text)?','int.parse(42)?'),'E_UNSUPPORTED_RESULT_SYNTAX'],
    [base.replace('return Ok(parsed)','return Err(parsed)'),'E_UNSUPPORTED_RESULT_SYNTAX'],
    [base.replace('on Ok(value) -> value','on Ok(value) -> missing'),'E_UNBOUND'],
    [base.replace('on Err() -> 0','on Err() -> trap 1'),'E_TYPE']
  ]) {
    assert.throws(()=>transpile(src), e=>e.code===code);
  }
});
test('result module per-tenant main call gate, no shared returned Error object',async()=>{
  const {module_source}=transpile(source('bad','9'));
  const compiled=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(module_source));
  const a=await compiled.create_tenant({tenant:'A',generation:1});
  const b=await compiled.create_tenant({tenant:'B',generation:1});
  assert.equal((await a.on_message()).value,'9');
  assert.equal((await b.on_message()).value,'9');
  await assert.rejects(a.on_message(),/E_MAIN_ALREADY_CALLED/);
});
