import test from 'node:test';
import assert from 'node:assert/strict';
import { compile as compileScalar } from '../src/compiler.mjs';
import { compileProgramV2, compileToProgramIRV2 } from '../src/program-v2.mjs';
import { validateProgramIRV2 } from '../src/program-ir-v2.mjs';

// Package-visible declarations must never leak into a root ESM namespace.
// This checks generated output, not only a parsed file-export descriptor.
const privateFn = 'fnc hidden(): int { return 17; }';
const packageSource = 'export pub[pkg] fnc hidden;\n' + privateFn;

test('program-v2 package function remains invisible in emitted ESM', async () => {
  const js = compileProgramV2(packageSource);
  const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(js));
  assert.equal(Object.hasOwn(mod, 'hidden'), false);
  assert.equal('hidden' in mod, false);

  const publicJs = compileProgramV2('export pub fnc hidden;\n' + privateFn);
  const publicModule = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(publicJs));
  assert.equal(publicModule.hidden(), 17n);
});

test('scalar emitter does not turn package-only function into public export', async () => {
  const js = compileScalar(packageSource);
  const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(js));
  assert.equal(Object.hasOwn(mod, 'hidden'), false);
});

test('untrusted IR cannot upgrade package visibility to public', () => {
  const admitted = compileToProgramIRV2(packageSource);
  const forged = structuredClone(admitted);
  forged.fileExports[0].visibility = 'public';
  assert.throws(() => validateProgramIRV2(forged), /export visibility does not match symbol table/);
  assert.deepEqual(validateProgramIRV2(admitted).fileExports, [
    { name: 'hidden', kind: 'fnc', visibility: 'package' }
  ]);
});
