import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=(value)=>parseStrictJsonReport(value,100000,'untrusted parity');
test('depth 64 is admitted but an extra nested container is refused',()=>{
  const atLimit='['.repeat(64)+'0'+']'.repeat(64);
  const overLimit='['.repeat(65)+'0'+']'.repeat(65);
  let result=parse(atLimit);
  for(let i=0;i<64;i++)result=result[0];
  assert.equal(result,0);
  assert.throws(()=>parse(overLimit),/depth or complexity exceeded/);
});

test('20000 parsed values is allowed but 20001 must be rejected pre-materialization',()=>{
  const allowed='['+Array(19999).fill('0').join(',')+']';
  const refused='['+Array(20000).fill('0').join(',')+']';
  assert.equal(parse(allowed).length,19999);
  assert.throws(()=>parse(refused),/depth or complexity exceeded/);
});

test('the byte ceiling is inclusive and cannot be bypassed with multibyte JSON',()=>{
  const raw='{"ok":"🚀"}';
  const bytes=Buffer.byteLength(raw,'utf8');
  assert.deepEqual(parseStrictJsonReport(raw,bytes,'parity'),{ok:'🚀'});
  assert.throws(()=>parseStrictJsonReport(raw,bytes-1,'parity'),/missing or oversized JSON report/);
});
