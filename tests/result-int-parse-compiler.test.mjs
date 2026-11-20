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
    [base.replace('int.parse(text)?','int.parse(42)?'),'E_TYPE'],
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

test('direct builtin match and escaped-source injection remain typed data',async()=>{
  const direct='pub fnc main(): int { return match int.parse("42") over on Ok(value) -> value, on Err() -> 0 end; }';
  assert.equal(await execute(direct),'42');
  // Escaping through the string token must never splice a JS statement.
  assert.equal(await execute(source('"); process.exit(77); ("','7')),'7');
  assert.equal(await execute(source('4\\u00002','7')),'7');
});

test('typed local Result and direct Result return execute without widening',async()=>{
  const variants=[
    'val parsed: int = int.parse(text)?; return Ok(parsed);',
    'return int.parse(text);'
  ];
  for(const body of variants) {
    for(const [value,expected] of [['42','42'],['invalid','7']]) {
      const program='fnc parse_id(string text): Result<int,Error> {'+body+'}\n'+
        'pub fnc main(): int { return match parse_id('+JSON.stringify(value)+') over on Ok(value) -> value, on Err() -> 7 end; }';
      assert.equal(await execute(program),expected);
    }
  }
});
test('type/return shape cannot be silently coerced to Result',()=>{
  for(const bad of [
    source('42').replace('val parsed =', 'val parsed: string ='),
    source('42').replace('val parsed = int.parse(text)?; return Ok(parsed);','return int.parse(text)?;')
  ]) {
    assert.throws(()=>transpile(bad),e=>
      e.code==='E_UNSUPPORTED_RESULT_SYNTAX' || e.code==='E_TYPE');
  }
});
