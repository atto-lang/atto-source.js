import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../src/compiler.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';

const allGeneratorSpellings = [
  'pub gen* values(): Iterator<int> { yield 1; }',
  'pub async gen* values(): AsyncIterator<int> { yield 1; }',
  'pub suspend gen* values(): AsyncIterator<int> { yield 1; }',
  'pub fnc gen* values(): Iterator<int> { yield 1; }',
  'pub routine gen* values(): Iterator<int> { yield 1; }',
  'pub async fnc gen* values(): AsyncIterator<int> { yield 1; }',
  'pub generator fnc values(): int { yield 1; }',
  'pub generator routine values(): int { yield 1; }'
];

test('scalar-v1 keeps all generator-v1 syntax fail-closed', () => {
  for (const source of allGeneratorSpellings)
    assert.throws(() => compile(source), /error:/, source);
});

test('program-v2 admits only its implemented canonical sync generator slice', () => {
  assert.doesNotThrow(() =>
    compileProgramV2('pub gen* values(): Iterator<int> { yield 1; return; }'));

  for (const source of allGeneratorSpellings.slice(1))
    assert.throws(() => compileProgramV2(source), /error:/, source);
});
