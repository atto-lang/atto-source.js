// Exact source fixtures and per-blob SHA from atto-platform-conformance #240.
// Execute the REAL JS compiler entrypoint; no manifest-only admission claims.
// Target test is NOT_EXECUTED until this full repository suite runs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compile,check,compileToIR} from '../src/compiler.mjs';

const cases = [
  {
    "name": "positive/type-first-infer.atto",
    "sha": "571c0fd3c75e922336c3e65e9577a587834ba5f0",
    "code": null
  },
  {
    "name": "positive/name-first-infer.atto",
    "sha": "0fd9e2b5f9f986a6c72cd86acf9f43cc095419e6",
    "code": null
  },
  {
    "name": "positive/name-first-arrow-void.atto",
    "sha": "0edf942651f43ced2f65943d1d16d33b0ecdb66d",
    "code": null
  },
  {
    "name": "positive/name-first-colon-void.atto",
    "sha": "e71f6a506d2f598d136a5a7b0157824298487fda",
    "code": null
  },
  {
    "name": "negative/duplicate-param.atto",
    "sha": "d0e7b3842eb8c12be2ea032e6a1bd371216d9d23",
    "code": "E_DUPLICATE"
  },
  {
    "name": "negative/void-return-value.atto",
    "sha": "91e113fa848c4f406dd9aefe38c0cc5b6b158d20",
    "code": "E_TYPE"
  },
  {
    "name": "negative/void-parameter.atto",
    "sha": "6f3dd803afc463f918c4b16be970b59da20cfe3d",
    "code": "E_TYPE"
  },
  {
    "name": "negative/legacy-result-missing-block.atto",
    "sha": "01323cc7aa918f41170553591defa3f40f0e2d10",
    "code": "E_SYNTAX"
  }
];
for (const {name,sha,code} of cases) {
  test('shared lambda fixture: ' + name, async () => {
    const data = await readFile(new URL('./fixtures/lambda-four-styles-v1/' + name, import.meta.url));
    const actual = createHash('sha1').update('blob ' + data.length)
      .update(Buffer.from([0])).update(data).digest('hex');
    assert.equal(actual, sha, 'fixture must match canonical Git blob');
    const source = data.toString('utf8');
    if (code) {
      assert.throws(() => compile(source), {code}, 'negative must generate no artifact');
      return;
    }
    const output = compile(source);
    assert.equal(output, compile(source), 'byte-deterministic emitted JavaScript');
    assert.equal(check(source), true);
    assert.throws(() => compileToIR(source), /error:/, 'scalar-v1 IR remains fail-closed');
    for (const forbidden of ['eval(', 'new Function', 'process.exit', 'globalThis.'])
      assert.equal(output.includes(forbidden), false, 'guest output must not embed host escape: ' + forbidden);
    const guest = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(output));
    assert.equal(guest.main(), 42n, 'actual guest must return signed i64 42');
  });
}
