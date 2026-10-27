import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../src/compiler.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';

const unsupported = [
  'pub gen* values(): Iterator<int> { yield 1; }',
  'pub async gen* values(): AsyncIterator<int> { yield 1; }',
  'pub suspend gen* values(): AsyncIterator<int> { yield 1; }'
];

for (const [name, compiler] of [['scalar-v1', compile], ['program-v2', compileProgramV2]]) {
  test(name + ': generator-v1 syntax fails closed until lowering exists', () => {
    for (const source of unsupported) {
      assert.throws(() => compiler(source), /error:/, source);
    }
  });
}
