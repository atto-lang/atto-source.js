import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

test('numeric integration preserves current-main guard and lazy boolean semantics',async()=>{
  for(const source of [
    'pub fnc main():int { guard false {return 42;} return 0; }',
    'pub fnc main():int {return true && false ? 0 : 42;}',
    'pub fnc main():int { val int n = 84 / 2; guard n eq 42 {return 0;} return n; }',
  ]){
    const ir=compileToProgramIRV2(source);
    const esm=compileProgramV2(source);
    assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
    const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
    assert.equal(guest.main(),42n,source);
  }
});
test('numeric integration does not open unsupported effect and ownership admission',()=>{
  for(const [source,diagnostic] of [
    ['pub fnc main():int {return copy! x;}','OWNERSHIP_BANG_BACKEND_UNSUPPORTED'],
    ['pub fnc main():int {return trap 1;}','trap requires verified ordinary-throw effect'],
    ['pub fnc main():int {select first {} return 42;}','static select requires checked'],
    ['pub fnc main():int {return panic! Error("bad");}','EXCEPTION_BANG_BACKEND_UNSUPPORTED'],
  ]) assert.throws(()=>compileProgramV2(source),e=>e.message.includes(diagnostic),source);
});

// Exact shared Rust #603 / Forge #257 fixtures, no syntax normalization.
const sharedQuotients = [
  {
    "name": "214-checked-literal-quotient.atto",
    "source": "// expect-exit: 42\npub fnc main(): int {\n  return (7 / 2) * 14 + (-7 / 3) + (7 / -3) + (-7 / -3) + 2;\n}\n",
    "blob": "957a6b87cbef0fc942d3dccdfc8ae0e23f7e2400"
  },
  {
    "name": "215-checked-literal-quotient-endpoints.atto",
    "source": "// expect-exit: 42\npub fnc main(): int {\n  return (9007199254740993 / 1 eq 9007199254740993) &&\n         (-9223372036854775808 / 1 eq -9223372036854775808) &&\n         (9223372036854775807 / 2 eq 4611686018427387903)\n         ? 42 : 1;\n}\n",
    "blob": "09baea8bbd05b4a3ff9e35433214a035d4b74f65"
  },
  {
    "name": "215-checked-literal-quotient-endpoints-v2.atto",
    "source": "// expect-exit: 42\npub fnc main(): int {\n  return (9007199254740993 / 1 eq 9007199254740993) &&\n         (-9223372036854775808 / 1 eq -9223372036854775808) &&\n         (9223372036854775807 / 2 eq 4611686018427387903) &&\n         (-1 / 2 eq 0) && (1 / -2 eq 0) &&\n         (0 / -9223372036854775808 eq 0) &&\n         (-9223372036854775808 / -9223372036854775808 eq 1) &&\n         (-9223372036854775808 / 3 eq -3074457345618258602) &&\n         (9223372036854775807 / -1 eq -9223372036854775807)\n         ? 42 : 1;\n}\n",
    "blob": "02108bee34fe4bcd051c22fbfdae0ef950e7c502"
  }
];
for (const f of sharedQuotients) test('shared Rust/Forge quotient: '+f.name, async()=>{
  const bytes=Buffer.from(f.source,'utf8');
  assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'), f.blob);
  const ir=compileToProgramIRV2(f.source);
  const esm=compileProgramV2(f.source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
  const guest=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
  assert.equal(guest.main(),42n);
});
