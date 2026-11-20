import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

// Trusted checked-i64 JS *guest execution* only. No proof of general Atto
// syntax, full actor lowering, Math.pow, Boolean operations or TenantVM isolation.
const compile = source => transpile_to_worker(source);
const guest = async (expression,returnForm='return') => {
  const source='pub fnc main(): int { '+returnForm+' '+expression+'; }';
  const output=compile(source);
  assert.equal(output.trusted,true);
  const mod=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(output.module_source));
  return (await (await mod.create_tenant({tenant:'test',generation:1}))
    .on_message()).value;
};

test('caret return shorthand is the same operation as return, not XOR or exponentiation',async()=>{
  for (const expr of ['5','40 + 2','-(2 + 5)','12 ^^ 10','8 <<< 2']) {
    assert.equal(await guest(expr,'^'),await guest(expr,'return'),expr);
  }
  assert.equal(await guest('5','^'),'5');
  assert.equal(await guest('40 + 2','^'),'42');
});

test('restricted actor main accepts caret return without altering actor semantics',async()=>{
  const source=[
    'define actor Counter as',
    'let int total = 0;',
    'receive(ActorMail<int> mail): void {',
    'self.total = self.total + mail.value;',
    'stdio.println(self.total); return;',
    '} end',
    'pub fnc main(): int { val counter = spawn Counter(); ^ 0; }'
  ].join(' ');
  const output=compile(source);
  assert.equal(output.guest_abi,'atto.js.browser.actor-subset.v1');
  const mod=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(output.module_source));
  const actor=await mod.create_tenant({tenant:'actor-test',generation:1});
  assert.deepEqual(await actor.on_message(),{value:'0',stdout:'',actors:1});
});

test('typed integer ^^ is bitwise XOR, not Boolean XOR or power',async()=>{
  assert.equal(await guest('12 ^^ 10'),'6');
  assert.equal(await guest('12 ^^ 10 ^^ 3'),'5');
  assert.equal(await guest('12 ^^ (10 ^^ 3)'),'5');
  assert.equal(await guest('2 ^^ 3'),'1');
});

test('^^ precedence is below shifts, addition and multiplication',async()=>{
  assert.equal(await guest('1 + 2 ^^ 3'),'0');
  assert.equal(await guest('1 ^^ 2 + 3'),'4');
  assert.equal(await guest('1 * 2 ^^ 3 + 1'),'6');
  assert.equal(await guest('2 ^^ 3 * 4'),'14');
  assert.equal(await guest('8 >>> 2 ^^ 1'),'3');
});

test('signed i64 bitwise XOR preserves bit patterns',async()=>{
  assert.equal(await guest('-1 ^^ 0'),'-1');
  assert.equal(await guest('-1 ^^ 9223372036854775807'),'-9223372036854775808');
  assert.equal(await guest('-9223372036854775808 ^^ -1'),'9223372036854775807');
});

test('<<< is 64-bit left shift, >>> is unsigned-bit logical right shift',async()=>{
  assert.equal(await guest('8 <<< 2'),'32');
  assert.equal(await guest('-1 >>> 1'),'9223372036854775807');
  assert.equal(await guest('-8 >>> 1'),'9223372036854775804');
  assert.equal(await guest('1 <<< 64'),'1');
  assert.equal(await guest('1 <<< -1'),'-9223372036854775808');
  assert.equal(await guest('(1 <<< 63) >>> 63'),'1');
  assert.equal(await guest('1 + 2 <<< 3'),'24');
  assert.equal(await guest('1 <<< 2 + 3'),'32');
  assert.equal(await guest('1 <<< 63'),'-9223372036854775808');
});

test('return ^ and infix ^^ cannot be conflated by lexer or emitter',async()=>{
  assert.equal(await guest('12 ^^ 10','^'),'6');
  assert.equal(await guest('(12 ^^ 10) <<< 1','^'),'12');
  assert.throws(()=>compile('pub fnc main(): int { return 12 ^ 10; }'),
    error=>error instanceof TranspileError && error.code==='E_UNSUPPORTED_SYNTAX');
  assert.throws(()=>compile('pub fnc main(): int { ^ ^ 5; }'),
    error=>error instanceof TranspileError);
});

test('<< and >> are I/O protocols, not integer shifts',()=>{
  for(const expr of ['8 << 2','8 >> 2','8 <<< 2 >> 1']){
    assert.throws(()=>compile('pub fnc main(): int { return '+expr+'; }'),
      error=>error instanceof TranspileError&&error.code==='E_IO_UNSUPPORTED',expr);
  }
});

test('unsupported power, bool and other bitwise constructs fail closed',()=>{
  for(const expr of ['Math.pow(2,3)','2 ** 3','2 % 3','1 & 3','~1','true ^^ false']){
    assert.throws(()=>compile('pub fnc main(): int { return '+expr+'; }'),
      error=>error instanceof TranspileError,expr);
  }
});

test('trivia cannot invent operators, preserved raw Unicode safeguards',async()=>{
  const src='// ^^ ^ <<< >>> << >> are comments\n'+
    'pub fnc main(): int { /* ^^ <<< */ ^ 12 ^^ 10; }';
  const output=compile(src);
  assert.equal(output.guest_abi,'atto.js.browser.subset.v1');
  assert.doesNotMatch(output.module_source,/\bimport\s*\(/);
  assert.equal(await guest('40 + 2','^'),'42');
});


test('line comments end at CR, LF, NEL, LS and PS; source cannot hide a return',async()=>{
  for(const ending of ['\r','\n','\r\n','\u0085','\u2028','\u2029']){
    const source='pub fnc main(): int { // return 0;'+ending+' ^ 42; }';
    const output=compile(source);
    const mod=await import('data:text/javascript;charset=utf-8,'+
      encodeURIComponent(output.module_source));
    const result=await (await mod.create_tenant({tenant:'line-end',generation:1})).on_message();
    assert.equal(result.value,'42','line-ending '+JSON.stringify(ending));
  }
});

test('operators in comments remain inert across every source line separator',()=>{
  for(const ending of ['\r','\n','\u0085','\u2028','\u2029']){
    const source='pub fnc main(): int { // ^^ <<< >>> << >>'+ending+' return 5; }';
    assert.equal(compile(source).guest_abi,'atto.js.browser.subset.v1');
  }
});

test('raw source bidi, NUL, ESC, DEL and lone surrogates still fail closed',()=>{
  for(const ch of ['\0','\x1b','\x7f','\u202e','\ud800','\udc00']){
    assert.throws(()=>compile('pub fnc main(): int { //'+ch+'\n ^ 42; }'),
      error=>error instanceof TranspileError,ch.codePointAt(0)?.toString(16));
  }
});
