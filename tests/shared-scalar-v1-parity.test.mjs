import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, readFile} from 'node:fs/promises';
import {compile, check, CompileError} from '../src/compiler.mjs';

// Byte-for-byte mirror of .NET and WASM scalar/v1. These are bootstrap
// admissions, NOT a claim about the full language or real LLVM/Wasm execution.
const pinnedBlobs = {
  "cases.json": "fd9df902b2df734ac62875037ca66db3ea41bc6b",
  "fixtures/literal-42.ores": "08b48c0ccd063bc863fb35b9e59d5c2ee6bc37d4",
  "fixtures/precedence.ores": "2dca1f2a9510bf5648850d8b38328fe38fe9aeed",
  "fixtures/unary.ores": "b018b5b8238f708f744254b5d278fe074ac60d19",
  "fixtures/i64-min.ores": "450ebee951733d3f0b567413e70724155d26ce13",
  "fixtures/i64-max.ores": "8193f4d6a5969fe0a53f0d2700ceb576033b45e3",
  "fixtures/i64-max-minus-one.ores": "c400f440fde2fbc10514ab7cfd2ffe3d19729ee1",
  "fixtures/reject-unknown.ores": "1c3ff45f58168c3f992c3666b7e216112b5fd64c",
  "fixtures/reject-division.ores": "74d97f3fc4cb6e0765dbf5ef378e52d90cd7187b",
  "fixtures/reject-actor.ores": "1ef9596b87dae01b99c0196bbc90795c857c02bd",
  "fixtures/reject-async.ores": "5ef809067332ab47cfacbc76fb2a287de865a01c",
  "fixtures/reject-structural.ores": "b889c7473344a6c058b824f35bad81938d198feb"
};
const expected = [
  {
    "id": "scalar.literal-42",
    "file": "fixtures/literal-42.ores",
    "kind": "accept",
    "value": "42"
  },
  {
    "id": "scalar.precedence",
    "file": "fixtures/precedence.ores",
    "kind": "accept",
    "value": "28"
  },
  {
    "id": "scalar.unary",
    "file": "fixtures/unary.ores",
    "kind": "accept",
    "value": "-21"
  },
  {
    "id": "scalar.i64-min",
    "file": "fixtures/i64-min.ores",
    "kind": "accept",
    "value": "-9223372036854775808"
  },
  {
    "id": "scalar.i64-max",
    "file": "fixtures/i64-max.ores",
    "kind": "accept",
    "value": "9223372036854775807"
  },
  {
    "id": "scalar.i64-max-minus-one",
    "file": "fixtures/i64-max-minus-one.ores",
    "kind": "accept",
    "value": "9223372036854775806"
  },
  {
    "id": "reject.unknown",
    "file": "fixtures/reject-unknown.ores",
    "kind": "reject"
  },
  {
    "id": "reject.division",
    "file": "fixtures/reject-division.ores",
    "kind": "reject"
  },
  {
    "id": "reject.actor",
    "file": "fixtures/reject-actor.ores",
    "kind": "reject"
  },
  {
    "id": "reject.async",
    "file": "fixtures/reject-async.ores",
    "kind": "reject"
  },
  {
    "id": "reject.structural",
    "file": "fixtures/reject-structural.ores",
    "kind": "reject"
  }
];
const root = new URL('../contracts/scalar/v1/', import.meta.url);

function gitBlobSha(bytes) {
  return createHash('sha1').update('blob ' + bytes.length + '\\0')
    .update(bytes).digest('hex');
}
async function pinnedBytes(path) {
  assert.ok(Object.hasOwn(pinnedBlobs, path), 'unexpected path: ' + path);
  const url = new URL(path, root);
  const stat = await lstat(url);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 &&
    stat.size <= 65536, 'fixture must be bounded regular file');
  const bytes = await readFile(url);
  assert.equal(bytes.length, stat.size, 'file changed during read');
  assert.equal(gitBlobSha(bytes), pinnedBlobs[path],
    'source fixture diverged from .NET/WASM: ' + path);
  return bytes;
}
async function reviewedCases() {
  const data = await pinnedBytes('cases.json');
  const manifest = JSON.parse(data.toString('utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['cases','schema_version']);
  assert.equal(manifest.schema_version, '1.0.0');
  assert.equal(manifest.cases.length, 11);
  assert.deepEqual(manifest.cases, expected, 'case order, value, kind and names must match');
  assert.equal(new Set(manifest.cases.map(row => row.id)).size, 11);
  assert.equal(new Set(manifest.cases.map(row => row.file)).size, 11);
  return manifest.cases;
}

test('scalar-v1: .NET/WASM manifest and all 11 source files are byte-exact', async () => {
  const cases = await reviewedCases();
  for (const row of cases) {
    assert.match(row.file, /^fixtures\\/[a-z0-9-]+\\.ores$/);
    await pinnedBytes(row.file);
  }
});

test('scalar-v1: real JS source-to-ESM matches shared values and bootstrap refusals', async t => {
  for (const row of await reviewedCases()) {
    await t.test(row.id, async () => {
      const source = (await pinnedBytes(row.file)).toString('utf8');
      if (row.kind === 'reject') {
        assert.throws(() => compile(source), err =>
          err instanceof CompileError && err.message.startsWith('error: '),
          'unsupported bootstrap constructs must fail at source compilation');
        return;
      }
      const esm = compile(source); // trusted, SHA-pinned source only
      const mod = await import('data:text/javascript;charset=utf-8,' +
        encodeURIComponent(esm));
      assert.equal(mod.main(), BigInt(row.value));
    });
  }
});

test('scalar-v1: .NET-style optional define declaration modifier', async () => {
  const esm = compile('define pub fnc main(): int { return 40 + 2; }');
  const mod = await import('data:text/javascript;charset=utf-8,' +
    encodeURIComponent(esm));
  assert.equal(mod.main(), 42n);
  assert.equal(check('define fnc internal(): int { return 7; }'), true);
  assert.doesNotMatch(compile('define fnc internal(): int { return 7; }'), /export \\{/);
  for (const invalid of [
    'define define pub fnc main(): int { return 42; }',
    'define pub define fnc main(): int { return 42; }',
    'define actor Worker as end'
  ]) assert.throws(() => compile(invalid), CompileError);
});
