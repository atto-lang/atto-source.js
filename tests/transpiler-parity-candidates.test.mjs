import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {
  compileToProgramIRV2,compileProgramIRV2,compileProgramV2
} from '../src/program-v2.mjs';

const manifest=JSON.parse(await readFile(
  new URL('../contracts/v1/transpiler-parity-candidates.json',import.meta.url),'utf8'));

test('50 immutable-commit-pinned parity candidates have strict checked-i64 source profiles',()=>{
  assert.equal(manifest.schemaVersion,1);
  assert.equal(manifest.integerModel,'signed-i64-checked-provisional');
  assert.equal(manifest.cases.length,50);
  assert.equal(new Set(manifest.cases.map(c=>c.id)).size,50);
  for(const item of manifest.cases){
    assert.deepEqual(Object.keys(item).sort(),['expected','id','source']);
    assert.match(item.id,/^[a-z][a-z0-9-]{0,79}$/);
    assert.match(item.source,
      /^\/\/ oreslang:checked-i64-v1\npub fnc main\(\): int \{return [0-9()+* -]+;\}\n$/);
    assert.ok(['value','checked-overflow'].includes(item.expected.kind));
    assert.equal(typeof item.expected.value,item.expected.kind==='value'?'string':'undefined');
  }
  const digest=createHash('sha256').update(JSON.stringify(manifest.cases),'utf8').digest('hex');
  assert.match(digest,/^[0-9a-f]{64}$/);
});

for(const item of manifest.cases){
  test('JS checked-i64 parity candidate: '+item.id,async()=>{
    const ir=compileToProgramIRV2(item.source);
    assert.equal(ir.integerModel,manifest.integerModel);
    const emitted=compileProgramIRV2(ir);
    assert.equal(emitted,compileProgramV2(item.source));
    const mod=await import('data:text/javascript,'+encodeURIComponent(emitted));
    if(item.expected.kind==='checked-overflow'){
      assert.throws(()=>mod.main(),/ORES_I64_OVERFLOW/);
    }else{
      assert.equal(mod.main(),BigInt(item.expected.value));
    }
  });
}
