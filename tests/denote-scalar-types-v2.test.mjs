import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToProgramIRV2,compileProgramV2} from '../src/program-v2.mjs';

const load=async source=>import('data:text/javascript;charset=utf-8,'+
  encodeURIComponent(compileProgramV2(source)));

test('scalar denotation is transparent through typed IR and emitted ESM',async()=>{
  const control='fnc id(int n): int { return n; } pub fnc main(): int { val int a = 42; return id(a); }';
  const alias='denote type Count = int; denote type Total = Count; fnc id(Count n): Total { return n; } pub fnc main(): Total { val Count a = 42; return id(a); }';
  assert.deepEqual(compileToProgramIRV2(alias),compileToProgramIRV2(control));
  assert.equal(await (await load(alias)).main(),42n);
});

test('bool denotation preserves checking and result',async()=>{
  const src='denote type Flag = bool; fnc identity(Flag b): Flag { return b; } pub fnc main(): int { return identity(true) ? 42 : 0; }';
  assert.equal(await (await load(src)).main(),42n);
  assert.throws(()=>compileProgramV2('denote type Flag = bool; fnc identity(Flag b): Flag { return b; } pub fnc main(): int { return identity(42) ? 42 : 0; }'));
});

test('invalid or unsupported denotations never emit ESM',()=>{
  const main=' pub fnc main(): int { return 42; }';
  for(const decl of [
    'denote type Count = ;','denote type Count as int;',
    'denote type Count = int','denote type Count = 5 | bool;',
    'denote type Count = Count;','denote type Count = Missing;',
    'denote type Count = int; denote type Count = bool;',
    'denote type String = int;','denote type Count<T> = T;',
    'denote pub type Count = int;','denote actor Count;',
    'denote type Count = int; define class Count as end',
    'use namespace n; denote type Count = int;',
  ]) assert.throws(()=>compileProgramV2(decl+main),undefined,decl);
});

test('contextual spelling does not change ordinary identifiers or comments',async()=>{
  const source='// denote type Count = bool;\nfnc denote(int n): int { return n; } pub fnc main(): int { return denote(42); }';
  assert.equal(await (await load(source)).main(),42n);
});

test('literal denotations prove immutable local membership before scalar lowering',async()=>{
  for(const binding of ['const Dice a = 5;','val Dice a = 6;','val Again a = 7;','val Dice a = -5;']){
    const source='denote type Dice = -5 | 5 | 6 | 7; denote type Again = Dice; pub fnc main(): int { '+binding+' return a + 42 - a; }';
    assert.equal(await (await load(source)).main(),42n);
  }
  const source='denote type Dice = 5 | 6 | 7; pub fnc main(): int { const Dice a = 5; return a + 37; }';
  const control='pub fnc main(): int { val int a = 5; return a + 37; }';
  assert.deepEqual(compileToProgramIRV2(source),compileToProgramIRV2(control));
});
test('literal denotations fail closed before integer erasure at unproved boundaries',()=>{
  for(const [body,diagnostic] of [
    ['const Dice a = 8; return 42;', /not a proven subset/],
    ['val Dice a = true; return 42;', /not a proven subset/],
    ['val int x = 8; val Dice a = x; return 42;', /not a proven subset/],
    ['val Dice a = 4 + 4; return 42;', /not a proven subset/],
    ['val Dice a = 5; a = 8; return a;', /E_STRING_REBIND/],
    ['val a : Dice = 5; return a;', /literal denotation requires/],
    ['let Dice a = 8; return a;', /not a proven subset/],
  ]) assert.throws(()=>compileProgramV2('denote type Dice = 5 | 6 | 7; pub fnc main(): int { '+body+' }'),diagnostic,body);
  for(const source of [
    'denote type Dice = 5 | 5; pub fnc main(): int { return 42; }',
    'denote type Dice = 9223372036854775808 | 5; pub fnc main(): int { return 42; }',
    'denote type Dice = 5 | ; pub fnc main(): int { return 42; }',
    'denote type Dice = 5 | 6; denote type Dice = int; pub fnc main(): int { return 42; }'
  ]) assert.throws(()=>compileProgramV2(source),undefined,source);
});

test('forward denotations preserve scalar identity and literal membership',async()=>{
  const forward='denote type First = Second; denote type Second = int; pub fnc main(): First { val First a = 42; return a; }';
  const control='pub fnc main(): int { val int a = 42; return a; }';
  assert.deepEqual(compileToProgramIRV2(forward),compileToProgramIRV2(control));
  assert.equal(await (await load(forward)).main(),42n);
  const union='denote type First = Second; denote type Second = 5 | 6; pub fnc main(): int { val First a = 5; return a + 37; }';
  assert.equal(await (await load(union)).main(),42n);
  assert.throws(()=>compileProgramV2(union.replace('a = 5','a = 8')),/not a proven subset/);
});
test('unused forward alias cycles and unresolved targets are distinguished',()=>{
  for(const decl of ['denote type A = A;','denote type A = B; denote type B = A;',
                     'denote type A = B; denote type B = C; denote type C = B;']){
    assert.throws(()=>compileProgramV2(decl+' pub fnc main(): int { return 42; }'),/cyclic type denotation/);
  }
  assert.throws(()=>compileProgramV2('denote type A = Missing; pub fnc main(): int { return 42; }'),/unresolved denotation target Missing/);
});
test('bounded iterative resolution admits 512 names but not a 513th',async()=>{
  const chain=n=>Array.from({length:n},(_,i)=>'denote type Alias'+i+' = '+(i===n-1?'int':'Alias'+(i+1))+';').join('\n')+
    '\npub fnc main(): Alias0 { return 42; }';
  assert.equal(await (await load(chain(512))).main(),42n);
  assert.throws(()=>compileProgramV2(chain(513)),/denotation count limit/);
});

test('closed literal union call boundaries prove subset arguments and returns',async()=>{
  const prefix='denote type Wide = 5 | 6 | 7; denote type Narrow = 5 | 6; ';
  const source=prefix+'fnc narrow(Narrow n): Wide { return n; } fnc wide(Wide n): Wide { return n; } pub fnc main(): int { return wide(narrow(5)) + 37; }';
  assert.equal(await (await load(source)).main(),42n);
  const control='fnc narrow(int n): int { return n; } fnc wide(int n): int { return n; } pub fnc main(): int { return wide(narrow(5)) + 37; }';
  assert.deepEqual(compileToProgramIRV2(source),compileToProgramIRV2(control));
  assert.equal(compileProgramV2(source),compileProgramV2(control));
  assert.equal(await (await load(prefix+'fnc pick(bool b): Narrow { return b ? 5 : 6; } pub fnc main(): int { return pick(true) + 37; }')).main(),42n);
  assert.equal(await (await load(prefix+'fnc id(Wide x): Wide { return x; } pub fnc main(): int { val Narrow n = 5; return id(n) + 37; }')).main(),42n);
  assert.equal(await (await load(prefix+'fnc id(Wide x): Wide { return x; } pub fnc main(): Wide { return id(5); }')).main(),5n);
});
test('closed literal union call boundaries reject unproven admissions',()=>{
  const prefix='denote type Wide = 5 | 6 | 7; denote type Narrow = 5 | 6; ';
  for(const [source,reason] of [
    ['fnc id(Narrow n): int { return n; } pub fnc main(): int { return id(8); }',/not a proven subset/],
    ['fnc id(Narrow n): int { return n; } fnc wider(Wide n): int { return id(n); } pub fnc main(): int { return wider(5); }',/not a proven subset/],
    ['fnc bad(): Narrow { return 7; } pub fnc main(): int { return bad(); }',/not a proven subset/],
    ['fnc bad(int n): Narrow { return n; } pub fnc main(): int { return bad(5); }',/not a proven subset/],
    ['fnc bad(bool b): Narrow { return b ? 5 : 8; } pub fnc main(): int { return bad(true); }',/not a proven subset/],
    ['pub fnc exposed(Narrow n): int { return n; } pub fnc main(): int { return 42; }',/external literal union admission/],
    ['fnc id(Narrow n): int { return n; } pub fnc main(): int { return id(4 + 4); }',/not a proven subset/],
    ['fnc id(Narrow n): int { return n; } pub fnc main(): int { return id(true); }',/not a proven subset/],
    ['fnc id(Narrow n): int { return n; } pub fnc main(): int { let int n = 5; return id(n); }',/mutable binding/],
  ]) assert.throws(()=>compileProgramV2(prefix+source),reason,source);
});

test('bounded arithmetic membership and root sequential mutable union bindings',async()=>{
  const prefix='denote type Wide = 5 | 6 | 7; denote type Narrow = 5 | 6; ';
  const run=body=>load(prefix+'pub fnc main(): int { '+body+' }');
  assert.equal((await run('const Wide x = 2 + 3; return x + 37;')).main(),42n);
  assert.equal((await run('let Wide x = 5; x = 6; x = 7; return x + 35;')).main(),42n);
  assert.equal((await run('let Wide x = 5; val Narrow y = 6; x = y; return x + 36;')).main(),42n);
  assert.equal((await run('val Wide x = 3 * 2; return x + 36;')).main(),42n);
  assert.equal((await run('let Wide x = 5; x = 2 * 3; return x + 36;')).main(),42n);
  assert.equal((await load(prefix+'fnc id(Narrow n): Narrow { return n; } pub fnc main(): int { return id(4 + 1) + 37; }')).main(),42n);
});
test('literal mutable assignments reject invalid values without widening or overflow',()=>{
  const prefix='denote type Wide = 5 | 6 | 7; denote type Narrow = 5 | 6; ';
  for(const [body,reason] of [
    ['let Wide x = 5; x = 8; return 42;',/not a proven subset/],
    ['let Narrow x = 5; val Wide y = 7; x = y; return 42;',/not a proven subset/],
    ['let Wide x = 5; x = true; return 42;',/not a proven subset/],
    ['let Wide x = 5; x = 9223372036854775807 + 1; return 42;',/not a proven subset/],
    ['let Wide x = 5; x = 5 / 1; return 42;',/not a proven subset/],
    ['let Wide x = 5; x = x + 1; return 42;',/not a proven subset/],
    ['val Wide x = 5; x = 6; return 42;',/E_STRING_REBIND/],
    ['let Wide x = 5; if true then x = 6; fi return x;',/E_STRING_VIEW_SCOPE/],
    ['let Wide x = 5; let Wide x = 6; return x;',/LOCAL_DUPLICATE_OR_SHADOW/],
  ]) assert.throws(()=>compileProgramV2(prefix+'pub fnc main(): int { '+body+' }'),reason,body);
});

test('literal union comparisons narrow independent branches and call arguments',async()=>{
  const prefix='denote type Wide = 5 | 6 | 7; denote type Narrow = 5 | 6; ';
  const id='fnc id(Narrow n): Narrow { return n; } ';
  const body='fnc select(Wide x): Narrow { if x != 7 then return id(x); else return 5; fi } ';
  for(const value of [5,6,7]){
    const src=prefix+id+body+'pub fnc main(): int { return select('+value+') + '+(value===6?36:37)+'; }';
    assert.equal((await load(src)).main(),42n);
  }
  for(const condition of ['x < 7','7 > x','x <= 6','not (x == 7)']){
    const src=prefix+id+'fnc select(Wide x): Narrow { return '+condition+' ? id(x) : 5; } pub fnc main(): int { return select(5) + 37; }';
    assert.equal((await load(src)).main(),42n);
  }
  const control=prefix+id+'fnc select(Wide x): Narrow { return x == 7 ? 5 : id(x); } pub fnc main(): int { return select(6) + 36; }';
  assert.equal((await load(control)).main(),42n);
});
test('literal match narrows explicit arms and residual defaults and proves exhaustiveness',async()=>{
  const prefix='denote type Wide = 5 | 6 | 7; denote type Narrow = 5 | 6; ';
  const id='fnc id(Narrow n): Narrow { return n; } ';
  for(const [arms,offset] of [
    ['on 5 -> id(x), on 6 -> id(x), on 7 -> 5',37],
    ['on 7 -> 5, default -> id(x)',37],
    ['on 5 -> id(x), on 6 -> id(x), default -> 5',37],
  ]){
    for(const v of [5,6,7]){
      const src=prefix+id+'fnc select(Wide x): Narrow { return match x over '+arms+' end; } pub fnc main(): int { return select('+v+') + '+(v===6?36:offset)+'; }';
      assert.equal((await load(src)).main(),42n);
    }
  }
  const full=prefix+'fnc select(Wide x): int { return match x over on 5 -> 42, on 6 -> 42, on 7 -> 42 end; } pub fnc main(): int { return select(7); }';
  const fallback=full.replace('on 7 -> 42','default -> 42');
  assert.deepEqual(compileToProgramIRV2(full),compileToProgramIRV2(fallback));
  assert.equal(compileProgramV2(full),compileProgramV2(fallback));
});
test('narrowing cannot leak across branches, writes, or incomplete match coverage',()=>{
  const prefix='denote type Wide = 5 | 6 | 7; denote type Narrow = 5 | 6; fnc id(Narrow n): Narrow { return n; } ';
  for(const [src,why] of [
    ['fnc bad(Wide x): Narrow { return x != 7 ? 5 : id(x); } pub fnc main(): int { return bad(7); }',/not a proven subset/],
    ['fnc bad(Wide x): Narrow { if x != 7 then return 5; fi return id(x); } pub fnc main(): int { return bad(7); }',/not a proven subset/],
    ['fnc bad(Wide x): Narrow { return match x over on 5 -> 5, on 6 -> 6 end; } pub fnc main(): int { return bad(7); }',/literal match requires all possible members/],
    ['fnc bad(int x): int { return match x over on 5 -> 5, on 6 -> 6 end; } pub fnc main(): int { return bad(5); }',/literal match requires all possible members/],
    ['fnc bad(Wide x): Narrow { return match x over on 5 -> 5, default -> id(x) end; } pub fnc main(): int { return bad(7); }',/not a proven subset/],
    ['fnc bad(Wide x): Narrow { return match x over on 5 -> 5, on 6 -> 6, on 7 -> 7 end; } pub fnc main(): int { return bad(7); }',/not a proven subset/],
    ['pub fnc main(): int { let Wide x = 5; x = 7; return id(x); }',/not a proven subset/],
    ['fnc bad(Wide x): Narrow { return match x over on 5 -> 5, on 5 -> 6, default -> 5 end; } pub fnc main(): int { return bad(5); }',/duplicate match pattern/],
  ]) assert.throws(()=>compileProgramV2(prefix+src),why,src);
});

test('bounded ordinary const strings retain keyword text and immutable typed slots',async()=>{
  const prefix='denote type Count = int; ';
  const body='pub fnc main(): int { const String s = "denote type Ignored = bool;"; const bool ok = true; return s == "denote type Ignored = bool;" && ok ? 42 : 0; }';
  assert.equal((await load(prefix+body)).main(),42n);
  assert.deepEqual(compileToProgramIRV2(prefix+body),compileToProgramIRV2(body.replace('const String','val string').replace('const bool','val bool')));
  const exact='// denote type Ignored = bool;\npub fnc main(): int { const String s = "denote type Ignored = bool;"; return 42; }\n';
  assert.equal((await load(exact)).main(),42n);
  for(const binding of ['const String s = 42;','const bool s = 42;','const String s = "a"; s = "b";','const String s = "a"; return s;']){
    assert.throws(()=>compileProgramV2('pub fnc main(): int { '+binding+' return 42; }'));
  }
  assert.equal((await load('denote type Dice = 5 | 6; pub fnc main(): int { const String s = "hello"; val Dice x = 5; return x + 37; }')).main(),42n);
});
