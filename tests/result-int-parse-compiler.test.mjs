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


test('checked braced match lowers a typed i64 guard, not arbitrary guest expressions',async()=>{
  const good='pub fnc main(): int { match int.parse("-00042") over '+
    'on Ok(n) -> { if n eq -42 then return 42; else return 0; fi } '+
    'on Err() -> { return 0; } end }';
  assert.equal(await execute(good),'42');
  assert.equal(await execute(good.replace('n eq -42','n eq -41')),'0');
  assert.throws(()=>transpile(good.replace('if n eq','if missing eq')), e=>e.code==='E_UNBOUND');
  assert.throws(()=>transpile(good.replace('return 42;','42;')), e=>e.code==='E_UNSUPPORTED_RESULT_SYNTAX');
  const unsafe=good.replace('on Err() -> { return 0; }',
    'on Err(e) -> { if e eq 0 then return 42; else return 0; fi }');
  assert.throws(()=>transpile(unsafe),e=>e.code==='E_TYPE');
  const nonexhaustive=good.replace('on Err() -> { return 0; }','');
  assert.throws(()=>transpile(nonexhaustive),e=>e.code==='E_MATCH_NONEXHAUSTIVE');
});


test('Atto Error is nominal, identity-preserving and has no host stack',async()=>{
  const {module_source}=transpile(source('bad','7'));
  // Test-only named export; production guest module does not expose its parser.
  const probe=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(module_source+'\nexport { int_parse };'));
  const first=probe.int_parse('bad'), second=probe.int_parse('bad');
  assert.equal(first.tag,1);
  assert.equal(first.error.message,'invalid integer');
  assert.equal(first.error.stack,undefined);
  assert.equal(Object.hasOwn(first.error,'stack'),false);
  assert.equal(first.error instanceof Error,false);
  assert.equal(first.error.constructor.name,'AttoError');
  assert.equal(Object.isFrozen(first),true);
  assert.equal(Object.isFrozen(first.error),true);
  assert.equal(Object.isFrozen(Object.getPrototypeOf(first.error)),true);
  assert.notStrictEqual(first.error,second.error);
  const propagated=first; // A caller must retain the same original Err handle.
  assert.strictEqual(propagated.error,first.error);
});

test('nominal on is Result patterns compile to byte-identical trusted JS guests',async()=>{
  const old=source('42','7');
  const next=old.replace('on Ok(value)','on is Ok<value>')
    .replace('on Err()','on is Err<error>');
  const oldGuest=transpile(old),isGuest=transpile(next);
  assert.equal(oldGuest.guest_abi,'atto.js.browser.result-int-parse.v1');
  assert.equal(isGuest.guest_abi,oldGuest.guest_abi);
  assert.equal(isGuest.module_source,oldGuest.module_source,
    'is-ADT constructor binders must not alter generated guest instructions');
  for(const [value,expected] of [
    ['42','42'],['+42','42'],['bad','7'],
    ['9223372036854775808','7']
  ]) {
    const before=source(value,'7');
    const after=before.replace('on Ok(value)','on is Ok<value>')
      .replace('on Err()','on is Err<error>');
    assert.equal(await execute(before),expected);
    assert.equal(await execute(after),expected);
  }
  const discard=next.replace('Ok<value> -> value','Ok<_> -> 5');
  assert.equal(await execute(discard),'5');
  assert.equal(await execute(discard.replace('"42"','"invalid"')),'7');
  const errWildcard=next.replace('Err<error>','Err<_>');
  assert.equal(await execute(errWildcard.replace('"42"','"invalid"')),'7');
});
test('on is patterns reject arbitrary extractors, wrong families, and unchecked payloads',()=>{
  const old=source('42','7');
  const canonical=old.replace('on Ok(value)','on is Ok<value>')
    .replace('on Err()','on is Err<error>');
  const negatives=[
    [canonical.replace('Ok<value>','Some<value>'),'E_TYPE'],
    [canonical.replace('Ok<value>','None'),'E_TYPE'],
    [canonical.replace('Ok<value>','ArbitraryExtractor<value>'),'E_PATTERN'],
    [canonical.replace('Ok<value>','Ok'),'E_ARITY'],
    [canonical.replace('Ok<value>','Ok<>'),'E_UNSUPPORTED_RESULT_SYNTAX'],
    [canonical.replace('Ok<value>','Ok<Some<value>>'),'E_UNSUPPORTED_RESULT_SYNTAX'],
    [canonical.replace('Ok<value>','Ok<left,right>'),'E_UNSUPPORTED_RESULT_SYNTAX'],
    [canonical.replace('Err<error>','Err()'),'E_ARITY'],
    [canonical.replace('on is Err<error> -> 7','on Err() -> 7, on is Err<error> -> 8'),'E_MATCH_DUPLICATE'],
    [canonical.replace('Ok<value> -> value','Ok<_> -> _'),'E_UNBOUND'],
  ];
  for(const [bad,code] of negatives)
    assert.throws(()=>transpile(bad),e=>e.code===code,
      'nominal ADT code must fail without a generated guest: '+bad);
});

test('nominal on-is Result patterns preserve checked braced match and guard semantics',async()=>{
  const old='pub fnc main(): int { match int.parse("-00042") over '+
    'on Ok(n) -> { if n eq -42 then return 42; else return 0; fi } '+
    'on Err() -> { return 0; } end }';
  const newer=old.replace('on Ok(n)','on is Ok<n>')
    .replace('on Err()','on is Err<error>');
  assert.equal(transpile(newer).module_source,transpile(old).module_source);
  assert.equal(await execute(newer),'42');
  assert.equal(await execute(newer.replace('n eq -42','n eq -41')),'0');
  assert.throws(()=>transpile(newer.replace('if n eq','if missing eq')),
    e=>e.code==='E_UNBOUND');
  assert.throws(()=>transpile(newer.replace('on is Err<error> -> { return 0; }','')),
    e=>e.code==='E_MATCH_NONEXHAUSTIVE');
});
