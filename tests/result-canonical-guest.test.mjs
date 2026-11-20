import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { transpile_to_worker } from '../src/transpile-worker.mjs';

// Byte-exact conformance inputs from atto-platform-conformance PR #68,
// commit e1164c269fc61726ff58a05003d2311a3f7d1f31.
// This exercises actual source compilation + guest JS evaluation, NOT a
// hand-written JS parser substitute. Pin Git *blob* SHA, not a text digest.
const cases = [
  ['parse-id-ok', '41b7dfd0338c470af195d8c1a4e2afaac7bacbd6', '42'],
  ['parse-id-invalid', '3a43c445e0bea782f98df24edf138265604797c7', '0'],
  ['int-parse-min', 'e58c3ad966c9d212b6498621f6f2805753d1be2e', '42'],
  ['int-parse-max-overflow', '2f2084b3174c30fcfec07df91a09deadb3d2cfaa', '42'],
  ['int-parse-min-overflow', 'b602d33a89608579b5d69e309955c6e1355fee31', '42'],
  ['int-parse-leading-zeroes', 'a93d6350158d109cf6ee924cb6a8816c385c56a3', '42'],
  ['int-parse-empty', 'f76de39b6ec0f19f28c25e03ad5984a3bd7adf7c', '42'],
  ['int-parse-nonascii', '047b0c5c9487f62431ec4c80e0c05af975664736', '42'],
  ['int-parse-overlong', '216aab01da15e08155b25d650affbc52868c7cb3', '42'],
  ['int-parse-max-admitted-length', '40ba3931ae7ee83cd7253a7f64cbd03a8b9690a3', '42'],
];

function blob_sha(source) {
  const bytes = Buffer.from(source, 'utf8');
  return createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0', 'utf8'))
    .update(bytes).digest('hex');
}

for (const [name, expectedBlob, expectedExit] of cases) {
  test('canonical Result/int.parse guest: ' + name, async () => {
    const path = new URL('./fixtures/trap-result-v1/' + name + '.atto', import.meta.url);
    const source = readFileSync(path, 'utf8');
    assert.equal(blob_sha(source), expectedBlob, 'canonical source changed');
    const lowered = transpile_to_worker(source);
    assert.equal(lowered.guest_abi, 'atto.js.browser.result-int-parse.v1');
    const uri = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(lowered.module_source);
    const compiled = await import(uri);
    // Each call makes its own one-shot tenant-local closure.
    const first = await compiled.create_tenant({tenant:'A',generation:1});
    const second = await compiled.create_tenant({tenant:'B',generation:1});
    assert.equal((await first.on_message()).value, expectedExit);
    assert.equal((await second.on_message()).value, expectedExit);
    await assert.rejects(first.on_message(), /E_MAIN_ALREADY_CALLED/);
    await assert.rejects(second.on_message(), /E_MAIN_ALREADY_CALLED/);
  });
}
