import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileProgramV2,compileAttoScalarV1,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

const fixtures=[
  {
    "id": "ordered-float-nan",
    "blob": "01079335342d403bcb42d731012588321edbc460",
    "source": "// Candidate guest test: IEEE-754 NaN is unordered for every ordered predicate.\n// Expected main exit value 42. NO actual guest/AOT execution certified.\npub fnc main(): int {\n  val float nan = 0.0 / 0.0;\n  if nan < 1.0 || nan <= 1.0 || nan > 1.0 || nan >= 1.0 then\n    return 1;\n  fi\n  return 42;\n}\n"
  },
  {
    "id": "ordered-float-signed-zero",
    "blob": "8030687c74d7243d8275451f89b96ab9757534c0",
    "source": "// Candidate guest test: IEEE-754 -0.0 and +0.0 compare equal in ordering.\n// Expected main exit value 42. NO actual guest/AOT execution certified.\npub fnc main(): int {\n  val float minus_zero = -0.0;\n  if minus_zero < 0.0 || minus_zero > 0.0 then\n    return 1;\n  fi\n  if minus_zero <= 0.0 && minus_zero >= 0.0 then\n    return 42;\n  fi\n  return 2;\n}\n"
  },
  {
    "id": "ordered-int-float-precision",
    "blob": "2d57f49dd16760f94bef1525b95dfc20ba654a9a",
    "source": "// Candidate guest test: avoid lossy binary64 comparison beyond 2^53.\n// Expected main exit value 42. No implied mixed-type coercion or AOT certification.\npub fnc main(): int {\n  val int exact = 9007199254740993;\n  val float rounded = 9007199254740992.0;\n  if exact > rounded then\n    return 42;\n  fi\n  return 1;\n}\n"
  },
  {
    "id": "equality-numeric-exact",
    "blob": "b09deb61e5ead17261174200cb409ed46566f053",
    "source": "// Candidate guest program: exact mixed i64/float equality, NaN, signed zero.\n// Expected main() = 42; NOT_EXECUTED on any guest compiler or AOT backend.\npub fnc main(): int {\n  val int exact = 9007199254740993;\n  val float rounded = 9007199254740992.0;\n  val float nan = 0.0 / 0.0;\n  val float negative_zero = -0.0;\n  if exact eq rounded || rounded eq exact then\n    return 1;\n  fi\n  if nan eq nan || negative_zero neq 0.0 then\n    return 2;\n  fi\n  if exact neq rounded && nan neq nan && negative_zero eq 0.0 then\n    return 42;\n  fi\n  return 3;\n}\n"
  }
];
let serial=0;
async function run(source) {
  const code=compileProgramV2(source);
  const guest=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')+'#'+(++serial));
  return guest.main();
}
test('four unchanged shared floating-point fixtures execute in real generated ESM',async()=>{
  for(const f of fixtures){
    const bytes=Buffer.from(f.source);
    assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),f.blob);
    assert.equal(await run(f.source),42n,f.id);
    assert.throws(()=>compileAttoScalarV1(f.source),f.id);
  }
});
test('mixed exact comparisons do not round the integer or coerce bools',async()=>{
  for(const body of [
    'val float x = 9007199254740992.0; return 9007199254740993 > x ? 42 : 0;',
    'val float x = -0.0; return x eq 0.0 ? 42 : 0;',
    'val float x = 0.0 / 0.0; return x neq x ? 42 : 0;',
    'val float x = 1.0 / 0.0; return 9223372036854775807 < x ? 42 : 0;',
    'val float x = -1.0 / 0.0; return x < -9223372036854775808 ? 42 : 0;'
  ]) assert.equal(await run('pub fnc main(): int { '+body+' }'),42n,body);
  for(const body of [
    'val float x = 1; return 42;',
    'val int x = 1.0; return 42;',
    'val float x = 1.0 + 2; return 42;',
    'val float x = 1.0; return x;',
    'val float x = 1.0; return x eq true ? 42 : 0;'
  ]) assert.throws(()=>compileProgramV2('pub fnc main(): int { '+body+' }'),body);
});
test('forged float capture and numeric comparator type claims fail validation',()=>{
  const source='pub fnc main(): int { val float x = 1.0; return x eq 1 ? 42 : 0; }';
  const wrong=compileToProgramIRV2(source);
  wrong.functions[0].body.body.condition.leftType='int';
  assert.throws(()=>compileProgramIRV2(wrong));
  const escaped=compileToProgramIRV2(source);
  escaped.functions[0].body.init={kind:'floatCapture',slot:0};
  assert.throws(()=>compileProgramIRV2(escaped));
});

test('signed-zero reciprocal, i64 limit and fractional comparison remain exact',async()=>{
  for(const body of ["val float x=-0.0; return (1.0/x)<0.0 ? 42:0;","val float x=9223372036854775808.0; return 9223372036854775807<x?42:0;","val float x=0.5; return 0 < x && x < 1 ? 42:0;","val float x=0.1+0.2; return x>0.3?42:0;"])assert.equal(await run('pub fnc main():int{'+body+'}'),42n,body);
  for(const body of ["val float x=1.0 ^^ 2.0;return 42;","val float x=1.0 <<< 2;return 42;","val float x=1.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000;return 42;"])assert.throws(()=>compileProgramV2('pub fnc main():int{'+body+'}'),undefined,body);
});
