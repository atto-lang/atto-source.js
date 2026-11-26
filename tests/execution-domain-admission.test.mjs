import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../src/compiler.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';
import {compileClassMethodsV1} from '../src/class-methods-v1.mjs';
import {compileFreestandingCore} from '../src/freestanding-core.mjs';

// Every source frontend must apply the same execution-domain admission.
const FRONTENDS = {
  'scalar-v1': compile,
  'program-v2': compileProgramV2,
  'class-methods-v1': compileClassMethodsV1,
  'freestanding-core': compileFreestandingCore,
};

const REJECTED = [];
for (const word of ['cpu', 'gpu', 'quantum']) {
  REJECTED.push(
    [`function named ${word}`, `pub fnc ${word}(): int {\n  return 1;\n}\n`, /execution domain '/],
    [`parameter named ${word}`, `pub fnc main(int ${word}): int {\n  return ${word};\n}\n`, /execution domain '/],
    [`${word} block`, `pub fnc main(): int {\n  return ${word} { 1 };\n}\n`, /execution domain '/],
    [`${word} modifier`, `pub ${word} fnc main(): int {\n  return 1;\n}\n`, /execution domain '/],
    [`${word} task`, `pub fnc main(): int {\n  return ${word} task { 1 };\n}\n`, /execution domain '/],
    [`nb ${word}`, `pub fnc main(): int {\n  return nb ${word} { 1 };\n}\n`, /execution domain '/],
  );
}
REJECTED.push(
  ['default task block', 'pub fnc main(): int {\n  return task { 1 };\n}\n', /execution task/],
  ['legacy nb block', 'pub fnc main(): int {\n  return nb { 1 };\n}\n', /legacy nb execution task/],
);

// Domain words in comments, longer identifiers, and a non-block `task`
// identifier stay ordinary source. Each frontend admits a different profile.
const SCALAR_CONTROL = '// gpu { cpu { quantum } } task { }\n'
  + 'pub fnc compute_gpu(int task): int {\n'
  + '  /* nb { gpu task { 1 } } */\n'
  + '  return task + 1;\n'
  + '}\n';
const CONTROLS = {
  'scalar-v1': SCALAR_CONTROL,
  'program-v2': SCALAR_CONTROL,
  'class-methods-v1': 'pub define class GpuStats as\n'
    + '  // gpu { cpu { quantum } }\n'
    + '  pub mtd read(self,int value) -> int :: return value; end\n'
    + 'end\n',
  'freestanding-core': 'define module core\n'
    + '  // gpu { cpu { quantum } } task { }\n'
    + '  pub fnc compute_gpu(int task): int { return task + 1; }\n'
    + 'end\n',
};

for (const [frontend, compileSource] of Object.entries(FRONTENDS)) {
  for (const [name, source, diagnostic] of REJECTED) {
    test(`${frontend} rejects ${name} with an execution-domain diagnostic`, () => {
      assert.throws(() => compileSource(source), diagnostic);
    });
  }

  test(`${frontend} keeps comments and longer identifiers ordinary`, () => {
    assert.doesNotThrow(() => compileSource(CONTROLS[frontend]));
  });
}

for (const [frontend, compileSource] of Object.entries(FRONTENDS)) {
  for (const source of [
    'pub unsafe fnc main(): int { return 42; }',
    'pub fnc main(): int { unsafe { } return 42; }',
    'pub fnc unsafe(): int { return 42; }',
    'pub fnc main(): int { return 42; } // inert\runsafe',
  ]) test(frontend+' denies unsafe before lowering: '+source, () =>
    assert.throws(() => compileSource(source), /E_UNSAFE_UNSUPPORTED/));
  test(frontend+' permits longer unsafe-like identifier and inert comment', () =>
    assert.doesNotThrow(() => compileSource(CONTROLS[frontend].replaceAll('gpu','unsafe_tools'))));
}
