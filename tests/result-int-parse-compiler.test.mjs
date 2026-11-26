import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker as transpile, TranspileError} from '../src/transpile-worker.mjs';

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


test('generated Result guest fails closed on invalid tenant identity and epoch',async()=>{
  const {module_source}=transpile(source('42'));
  const compiled=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(module_source));
  for(const params of [
    undefined, {}, {tenant:'',generation:1}, {tenant:'  ',generation:1},
    {tenant:' x',generation:1}, {tenant:'x ',generation:1},
    {tenant:'a',generation:0}, {tenant:'a',generation:-1},
    {tenant:'a',generation:2147483648}, {tenant:'a',generation:1.5},
    {tenant:'a',generation:'1'}, {tenant:'a'.repeat(129),generation:1},
  ]) {
    await assert.rejects(compiled.create_tenant(params),/E_TENANT_BINDING/);
  }
  const guest=await compiled.create_tenant({tenant:'a',generation:2147483647});
  assert.equal(Object.isFrozen(guest),true,'trusted guest adapter must not be mutable');
  assert.equal((await guest.on_message()).value,'42');
  await assert.rejects(guest.on_message(),/E_MAIN_ALREADY_CALLED/);
});


test('nominal on-is Result: deterministic hostile and boundary source corpus',async()=>{
  const initial=[
    '0','-0','+0','-9223372036854775808','9223372036854775807',
    '9223372036854775808','-9223372036854775809','+','-','','00',
    '4_2','42 ', '4\\0'+'2','é','٤٢','0'.repeat(1024),'0'.repeat(1025)
  ];
  let seed=0xA77015;
  const alphabet='0123456789+-_ xé';
  const random=()=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return seed;
  };
  const cases=[...initial];
  for(let i=0;i<110;i++){
    const count=random()%72;
    let value='';
    for(let j=0;j<count;j++)value+=alphabet[random()%alphabet.length];
    cases.push(value);
  }
  for(const value of cases){
    const old='pub fnc main(): int { return match int.parse('+
      JSON.stringify(value)+') over on Ok(value) -> value, on Err() -> 9 end; }';
    const newer=old.replace('on Ok(value)','on is Ok<value>')
      .replace('on Err()','on is Err<error>');
    assert.equal(transpile(newer).module_source,transpile(old).module_source,
      'different Result guest code for '+JSON.stringify(value));
    const decimal=/^[+-]?[0-9]+$/.test(value);
    const n=decimal ? BigInt(value) : null;
    const expected=n!==null&&value.length<=1024&&
      n>=-9223372036854775808n&&n<=9223372036854775807n
      ? String(n) : '9';
    assert.equal(await execute(newer),expected,
      'wrong checked Result branch for '+JSON.stringify(value));
  }
});


test('trap on an existing Result preserves the exact generated guest and Ok/Err layers',async()=>{
  for(const [input,expected] of [['42','42'],['invalid','7']]) {
    const plain=source(input,'7');
    // Compare each trapped spelling to its structurally identical untrapped
    // source, not to an unrelated Result-producing return strategy.
    const directlyReturned=plain.replace(
      'val parsed = int.parse(text)?; return Ok(parsed);',
      'return int.parse(text);');
    assert.notEqual(directlyReturned,plain,'direct-return baseline must exist');
    const pairs=[
      [plain,plain.replace('return match parse_id(', 'return match trap parse_id(')],
      [plain,plain.replace('val parsed = int.parse(text)?;', 'val parsed = trap int.parse(text)?;')],
      [directlyReturned,directlyReturned.replace('return int.parse(text);','return trap int.parse(text);')],
    ];
    for(const [untrapped,trapped] of pairs){
      assert.notEqual(trapped,untrapped,'fixture must contain the trap spelling');
      const baseline=transpile(untrapped);
      const candidate=transpile(trapped);
      assert.equal(candidate.guest_abi,baseline.guest_abi);
      assert.equal(candidate.module_source,baseline.module_source,
        'Result-valued trap must preserve the same IR/ESM and avoid host catches');
      assert.equal(await execute(untrapped),expected);
      assert.equal(await execute(trapped),expected);
    }
  }
  const direct='pub fnc main(): int { return match int.parse("invalid") over '+
    'on Ok(value) -> value, on Err() -> 7 end; }';
  const trapped=direct.replace('match int.parse(', 'match trap int.parse(');
  assert.equal(transpile(trapped).module_source,transpile(direct).module_source);
  assert.equal(await execute(trapped),'7');
});

test('trap denies untyped calls, arbitrary scalar operands, and nested trapping',()=>{
  const plain=source('42');
  const malformed=[
    [plain.replace('match parse_id(', 'match trap host('),'E_TRAP_UNSUPPORTED'],
    [plain.replace('match parse_id(', 'match trap trap parse_id('),'E_TRAP_UNSUPPORTED'],
    [plain.replace('match parse_id(', 'match trap 42('),'E_TRAP_UNSUPPORTED']
  ];
  for(const [src,code] of malformed)
    assert.throws(()=>transpile(src),e=>e.code===code,
      'no generated module may be returned for an unsupported trapped operand');
  const scalar='pub fnc main(): int { return trap 42; }';
  assert.throws(()=>transpile(scalar),e=>e.code==='E_UNSUPPORTED_EXPRESSION');
});


test('Result-valued trap evaluates the operand once on both success and Err',async()=>{
  for(const [input,expected] of [['42','42'],['invalid','7']]) {
    const guestSource='pub fnc main(): int { return match trap int.parse('+
      JSON.stringify(input)+') over on Ok(value) -> value, on Err() -> 7 end; }';
    const {module_source}=transpile(guestSource);
    const before='function int_parse(text){';
    assert.ok(module_source.includes(before),'expected generated parser');
    const instrumented=module_source.replace(before,
      'let __parse_invocations = 0;\n'+before+'\n __parse_invocations++;')+
      '\nexport function __parse_count(){ return __parse_invocations; }\n';
    const mod=await import('data:text/javascript;charset=utf-8,'+
      encodeURIComponent(instrumented));
    const guest=await mod.create_tenant({tenant:'exactly-once',generation:1});
    assert.equal((await guest.on_message()).value,expected);
    assert.equal(mod.__parse_count(),1,'trap must not re-evaluate its operand');
    await assert.rejects(guest.on_message(),/E_MAIN_ALREADY_CALLED/);
    assert.equal(mod.__parse_count(),1,'rejected second turn must not call parser');
  }
});

test('Result identity trap never catches host faults as guest Err',async()=>{
  const sourceText='pub fnc main(): int { return match trap int.parse("42") over '+
    'on Ok(value) -> value, on Err() -> 7 end; }';
  const {module_source}=transpile(sourceText);
  const target='function int_parse(text){';
  assert.ok(module_source.includes(target),'expected typed guest int parser');
  // Test-only module instrumentation: a simulated host TextEncoder failure
  // must escape unchanged; production module code is not modified.
  const trappedHostFault=module_source.replace(target,
    "const host_fault=new Error('HOST_FAULT');\n"+
    'class TextEncoder { encode(){ throw host_fault; } }\n'+target)+
    '\nexport {host_fault};\n';
  const mod=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(trappedHostFault));
  const guest=await mod.create_tenant({tenant:'host-fault',generation:1});
  await assert.rejects(guest.on_message(),error=>error===mod.host_fault,
    'host error must retain identity and bypass guest trap');
});

test('unlowered ordinary throw and raise effects cannot masquerade as Result traps',()=>{
  const template='pub fnc main(): int { return match trap int.parse("42") over '+
    'on Ok(value) -> value, on Err() -> 7 end; }';
  for(const keyword of ['throw','raise','panic']){
    const sourceText=template.replace('trap int.parse("42")',
      'trap '+keyword+' Error("x")');
    assert.throws(()=>transpile(sourceText),e=>e.code==='E_TRAP_UNSUPPORTED');
  }
});


test('canonical trap! compiles to the same single Result layer as migration trap',async()=>{
  for(const [input,expected] of [['42','42'],['invalid','7']]){
    const ordinary=source(input,'7');
    const direct=ordinary.replace('val parsed = int.parse(text)?; return Ok(parsed);',
      'return int.parse(text);');
    const pairs=[
      [ordinary,ordinary.replace('match parse_id(','match trap! parse_id(')],
      [ordinary,ordinary.replace('val parsed = int.parse(text)?;',
        'val parsed = trap! int.parse(text)?;')],
      [direct,direct.replace('return int.parse(text);','return trap! int.parse(text);')]
    ];
    for(const [baseline,canonical] of pairs){
      assert.notEqual(canonical,baseline);
      const plain=transpile(baseline),bang=transpile(canonical);
      assert.equal(bang.guest_abi,plain.guest_abi);
      assert.equal(bang.module_source,plain.module_source,
        'trap! on already-Result must not double-wrap, catch host faults, or re-evaluate');
      assert.equal(await execute(canonical),expected);
    }
    assert.throws(()=>transpile(ordinary.replace('match parse_id(','match trap!parse_id(')),
      e=>e instanceof TranspileError&&e.code==='E_BANG_KEYWORD_WHITESPACE');
  }
  const direct='pub fnc main(): int { return match int.parse("invalid") over '+
    'on Ok(value) -> value, on Err() -> 7 end; }';
  const bang=direct.replace('match int.parse(','match trap! int.parse(');
  assert.equal(transpile(bang).module_source,transpile(direct).module_source);
  assert.equal(await execute(bang),'7');
});

test('bang syntax rejects unproved exceptional effects and operator boundary confusion',async()=>{
  const base='pub fnc main(): int { return match trap! int.parse("42") over '+
    'on Ok(value) -> value, on Err() -> 7 end; }';
  for(const [fragment,code] of [
    ['trap! host','E_TRAP_UNSUPPORTED'],
    ['trap! trap! int.parse','E_TRAP_UNSUPPORTED'],
    ['trap! throw! Error','E_TRAP_UNSUPPORTED'],
    ['trap! raise! Error','E_TRAP_UNSUPPORTED'],
    ['trap! panic! Error','E_TRAP_UNSUPPORTED'],
    ['trap!int.parse','E_BANG_KEYWORD_WHITESPACE'],
    ['trap!(int.parse','E_BANG_KEYWORD_WHITESPACE'],
    ['trap!/*gap*/ int.parse','E_BANG_KEYWORD_WHITESPACE'],
    ['trap!\u00a0int.parse','E_BANG_KEYWORD_WHITESPACE'],
    ['trap ! int.parse','E_UNSUPPORTED_TOKEN'],
    ['trap!= int.parse','E_UNSUPPORTED_TOKEN'],
    ['trap!eq int.parse','E_UNSUPPORTED_TOKEN']
  ]) {
    const bad=base.replace('trap! int.parse',fragment);
    assert.throws(()=>transpile(bad),e=>e.code===code,
      'unsupported spelling must not emit a guest artifact: '+fragment);
  }
  const data='pub fnc main(): int { return match int.parse('+
    JSON.stringify('trap! throw! raise! panic!')+') over '+
    'on Ok(value) -> value, on Err() -> 7 end; }';
  assert.equal(await execute(data),'7','string payload is never relexed as effects');
  assert.equal(await execute(base.replace('match trap!', 'match /* trap! throw! */ trap!')),'42');
});
