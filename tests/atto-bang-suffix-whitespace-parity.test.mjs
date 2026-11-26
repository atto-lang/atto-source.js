import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2} from '../src/program-v2.mjs';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

// Canonical AttoLang bang suffixes require ASCII whitespace; this verifies
// lexical parity without claiming unsupported effects acquire lowering.
const program=sep=>'pub fnc main():int{val x=trap!'+sep+'(7/0);return x.is_err()?42:0;}';
const worker=sep=>'pub fnc main():int{return match trap!'+sep+
  'int.parse("42") over on Ok(value) -> value, on Err() -> 0 end;}';
const emitted=async source=>{
  const js=compileProgramV2(source);
  const guest=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));
  return guest.main();
};
const workerGuest=async source=>{
  const artifact=transpile_to_worker(source);
  assert.equal(artifact.guest_abi,'atto.js.browser.result-int-parse.v1');
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(artifact.module_source));
  const guest=await mod.create_tenant({tenant:'bang-separator',generation:1});
  return (await guest.on_message()).value;
};

test('ASCII whitespace after trap! preserves checked Result guest semantics',async()=>{
  for(const gap of [' ','\t','\n','\r\n','\v','\f']){
    assert.equal(await emitted(program(gap)),42n,JSON.stringify(gap));
    assert.equal(await workerGuest(worker(gap)),'42',JSON.stringify(gap));
  }
});

test('missing or non-ASCII separators reject before Result emission',()=>{
  for(const gap of ['', '(','identifier','/*gap*/ ','\u00a0','//gap\n']){
    const a=program(gap),b=worker(gap);
    assert.throws(()=>compileProgramV2(a),
      error=>String(error).includes('E_BANG_KEYWORD_WHITESPACE'),JSON.stringify(gap));
    assert.throws(()=>transpile_to_worker(b),
      error=>error instanceof TranspileError&&error.code==='E_BANG_KEYWORD_WHITESPACE',
      JSON.stringify(gap));
  }
});

test('unsupported exceptional bang invocations are not silently reinterpreted',()=>{
  for(const keyword of ['throw','raise','panic']){
    const source='pub fnc main():int{'+keyword+'!(1);return 42;}';
    assert.throws(()=>compileProgramV2(source),
      error=>String(error).includes('E_BANG_KEYWORD_WHITESPACE'),keyword);
    assert.throws(()=>transpile_to_worker(source),
      error=>error instanceof TranspileError&&error.code==='E_BANG_KEYWORD_WHITESPACE',keyword);
  }
});
