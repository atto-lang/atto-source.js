import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

const source='pub fnc main(): int { return 42; }';
const high=String.fromCharCode(0xd800);
const low=String.fromCharCode(0xdc00);
const high2=String.fromCharCode(0xdbff);
const low2=String.fromCharCode(0xdfff);
const bad=[high,low,high2,low2,high+high2,low+low2,high+'a','a'+low];
test('reject lone or misplaced UTF-16 surrogates before comment elision',()=>{
  for(const badText of bad){
    for(const candidate of ['// '+badText+'\n'+source,
      '/*'+badText+'*/'+source, source+' // '+badText,
      source.replace('return','/*'+badText+'*/ return')]){
      assert.throws(()=>transpile_to_worker(candidate),error=>
        error instanceof TranspileError && error.code==='E_INVALID_UTF16');
    }
  }
});
test('valid astral Unicode inside comments and normal scalar source remain valid',()=>{
  const astral=String.fromCodePoint(0x1f680,0x1f4a1,0x10ffff);
  for(const candidate of [source,'// '+astral+'\n'+source,
    '/*'+astral+'*/ '+source,
    source+' // '+astral]){
    const compiled=transpile_to_worker(candidate);
    assert.equal(compiled.backend,'js');
    assert.equal(compiled.trusted,true);
  }
});
test('malformed source does not reach token generation',()=>{
  for(const candidate of [high+source,low+source,high+low2+high+source]){
    assert.throws(()=>transpile_to_worker(candidate),e=>
      e instanceof TranspileError && e.code==='E_INVALID_UTF16');
  }
});
