import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {compileProgramV2} from '../src/program-v2.mjs';

// Deliberately remove a generated helper's binding from final ESM. The
// resulting module must still parse but must NOT satisfy its guest contract.
// This directly protects generator-only Symbol/Option/Result helper discovery.
const mutationCases=[
  // Five independent generator-only Symbol expression programs.
  {id:'symbol-equality',helper:'_symbol',
    yield:'(#ready eq #ready) ? 42 : 0'},
  {id:'symbol-inequality',helper:'_symbol',
    yield:'(#ready neq #error) ? 42 : 0'},
  {id:'symbol-false-branch',helper:'_symbol',
    yield:'(#ready eq #error) ? 0 : 42'},
  {id:'symbol-neq-false-branch',helper:'_symbol',
    yield:'(#ready neq #ready) ? 0 : 42'},
  {id:'symbol-other-name',helper:'_symbol',
    yield:'(#done eq #done) ? 42 : 0'},
  // Five separately missing Option helpers, exercised ONLY by gen* yields.
  {id:'option-constructor',helper:'_some',
    yield:'Option.unwrap_or(Option.some(42),0)'},
  {id:'option-none',helper:'_none',
    yield:'Option.unwrap_or(Option.none(),42)'},
  {id:'option-predicate',helper:'_is_some',
    yield:'Option.is_some(Option.some(42)) ? 42 : 0'},
  {id:'option-default',helper:'_option_or',
    yield:'Option.unwrap_or(Option.some(42),0)'},
  {id:'option-validation',helper:'_checkoption',
    yield:'Option.unwrap_or(Option.some(42),0)'},
  // Five separately missing Result helpers.
  {id:'result-constructor',helper:'_ok',
    yield:'Result.unwrap_or(Result.ok(42),0)'},
  {id:'result-error-constructor',helper:'_err',
    yield:'Result.unwrap_err_or(Result.err(42),0)'},
  {id:'result-predicate',helper:'_is_ok',
    yield:'Result.is_ok(Result.ok(1)) ? 42 : 0'},
  {id:'result-default',helper:'_result_or',
    yield:'Result.unwrap_or(Result.ok(42),0)'},
  {id:'result-error-default',helper:'_error_or',
    yield:'Result.unwrap_err_or(Result.err(42),0)'},
  // Five additional helper binding checks inside typed gen* output.
  {id:'symbol-constructor-internal',helper:'_symbolKind',
    yield:'(#ready eq #ready) ? 42 : 0'},
  {id:'symbol-equality-internal',helper:'_symboleq',
    yield:'(#ready eq #ready) ? 42 : 0'},
  {id:'symbol-validation-internal',helper:'_checksymbol',
    yield:'(#ready eq #ready) ? 42 : 0'},
  {id:'option-tag-construction',helper:'_tag',
    yield:'Option.unwrap_or(Option.some(42),0)'},
  {id:'generic-int-check',helper:'_check',
    yield:'42'}
];
function removeHelperBinding(esm,name) {
  const original='function '+name+'(';
  const renamed='function _removed_'+name.slice(1)+'(';
  const position=esm.indexOf(original);
  assert.notEqual(position,-1,name+' helper is missing from original ESM');
  assert.equal(esm.indexOf(original,position+original.length),-1,
    name+' has an ambiguous declaration');
  return esm.slice(0,position)+renamed+esm.slice(position+original.length);
}
async function load(esm,tag) {
  const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{
    input:esm,encoding:'utf8',timeout:10000,maxBuffer:1024*1024
  });
  assert.equal(syntax.error,undefined,tag+' checker spawn');
  assert.equal(syntax.status,0,tag+' invalid ESM: '+syntax.stderr);
  return import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(esm)+'#'+encodeURIComponent(tag));
}
test('20 helper mutations cover Symbol, Option, Result and common validation',()=>{
  assert.equal(mutationCases.length,20);
  assert.equal(new Set(mutationCases.map(c=>c.id)).size,20);
  assert.equal(new Set(mutationCases.map(c=>c.helper)).size,16);
});
for(const c of mutationCases){
  test('detect missing generated runtime helper / '+c.id,async()=>{
    const source='pub gen* values():Iterator<int>{yield '+c.yield+';return;}';
    const correct=compileProgramV2(source);
    const mutant=removeHelperBinding(correct,c.helper);
    assert.notEqual(mutant,correct);
    const good=await load(correct,'helper-good-'+c.id);
    const bad=await load(mutant,'helper-mutant-'+c.id);
    const goodIterator=good.values();
    assert.deepEqual(goodIterator.next(),{value:42n,done:false});
    assert.deepEqual(goodIterator.next(),{value:undefined,done:true});
    const wrongIterator=bad.values();
    assert.throws(()=>wrongIterator.next(),e=>
      e instanceof ReferenceError&&e.message.includes(c.helper+' is not defined'),
      'missing '+c.helper+' must cause an observable guest failure');
  });
}
