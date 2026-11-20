import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {
  compileProgramV2, compileToProgramIRV2, compileProgramIRV2
} from '../src/program-v2.mjs';

// Byte-identical to Java PR #2386 at the specifically reviewed source commit
// 9371ba965e6d05ce2e4e934eb0cbf906a813dd9f.
// This is a shared scalar floor, not full six-backend feature parity.
const CANONICAL_GIT_BLOB='a948dbaf594916a6ee07f65d49a0cf5ae398ca7b';
const CANONICAL_HEADER='# id<TAB>expected_signed_i64<TAB>complete_Oreslang_source';

function loadCanonicalCases(raw) {
  // Check physical source bytes, not a normalized UTF-8 representation.
  const actual=createHash('sha1')
    .update('blob '+raw.byteLength+'\0')
    .update(raw)
    .digest('hex');
  assert.equal(actual,CANONICAL_GIT_BLOB,'shared scalar50 fixture byte identity');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  assert.ok(text.endsWith('\n'),'canonical fixture must end in a newline');
  const lines=text.slice(0,-1).split('\n');
  assert.equal(lines.length,52,'two header rows and exactly 50 source rows');
  assert.match(lines[0],/^# oreslang-scalar-50-v1 \|/);
  assert.equal(lines[1],CANONICAL_HEADER);
  return lines.slice(2).map((line,i)=>{
    const fields=line.split('\t');
    assert.equal(fields.length,3,'expected exact three-column TSV row');
    const [id,expected,source]=fields;
    assert.equal(id,'scalar-'+String(i+1).padStart(3,'0'));
    assert.match(expected,/^(?:0|[1-9][0-9]*)$/);
    const value=BigInt(expected);
    assert.ok(value>=0n&&value<=127n,'portable process-return scalar range');
    assert.match(source,/^pub fnc main\(\): int \{ return [0-9() +*\-]+; \}$/);
    return Object.freeze({id,source,expected:value});
  });
}

const canonicalBytes=await readFile(
  new URL('./fixtures/shared-scalar50-v1.tsv',import.meta.url));
const cases=loadCanonicalCases(canonicalBytes);

test('shared scalar50 uses the exact pinned Java cross-backend source bytes',()=>{
  assert.equal(cases.length,50);
  assert.equal(new Set(cases.map(item=>item.id)).size,50);
  const tampered=Buffer.from(canonicalBytes);
  tampered[tampered.length-2]^=1;
  assert.throws(()=>loadCanonicalCases(tampered),
    /shared scalar50 fixture byte identity/);
});

for(const item of cases) {
  test('real generated ESM, shared scalar50 '+item.id,async()=>{
    // Both source and direct validated IR entrypoints must produce identical
    // ESM from the exact same unchanged Oreslang source string.
    const ir=compileToProgramIRV2(item.source);
    assert.equal(ir.integerModel,'signed-i64-checked-provisional');
    const generated=compileProgramIRV2(ir);
    assert.equal(generated,compileProgramV2(item.source));
    const ns=await import(
      'data:text/javascript;charset=utf-8,'+encodeURIComponent(generated));
    assert.deepEqual(Object.keys(ns),['main']);
    assert.equal(typeof ns.main,'function');
    assert.equal(ns.main(),item.expected);
  });
}

test('shared scalar50 parity is not a license to silently wrap checked i64',async()=>{
  const compiled=compileProgramV2(
    '// oreslang:checked-i64-v1\npub fnc main(): int {return 9223372036854775807+1;}\n');
  const ns=await import(
    'data:text/javascript;charset=utf-8,'+encodeURIComponent(compiled));
  assert.throws(()=>ns.main(),/ORES_I64_OVERFLOW/);
});
