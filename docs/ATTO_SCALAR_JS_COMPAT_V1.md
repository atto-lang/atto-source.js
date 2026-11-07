# Experimental AttoLang scalar → JavaScript compatibility path

The canonical AttoLang scalar contract lives in the Java source repository
at `contracts/atto-scalar-v1/cases.json` (19 cases; contract evidence
`NOT_EXECUTED` at the reviewed revision). LLVM and Java have identical
`contracts/v1/source-i64/portable-i64.v1.json` bytes, Git blob
`bbc319c19ecd007109d33592e210091eb267e5a2`. The JS repository also
contains those identical portable expression bytes.

This path is **opt-in** and **experimental**:

```sh
node bin/oreslang-jsc.mjs --atto-scalar-v1 --check path/to/program.atto
node bin/oreslang-jsc.mjs --atto-scalar-v1 path/to/program.atto --out=/absolute/program.mjs
npm run test:atto-scalar-v1
```

The corresponding API is exported as `@oreslang/source-js/atto-scalar-v1`,
with `compileAttoScalarV1`, `compileToAttoScalarIRV1`, and
`checkAttoScalarV1`. These use the **existing validated program-v2 IR** and
its checked-i64 provisional arithmetic; there is no new interoperable IR
dialect and no change to the legacy default scalar-v1 wrapping profile.

## Precise scope

- Seven shared, non-overflowing source-i64 expressions are compiled to ESM and
  exercised as BigInt guest calls by the new source-local Node tests.
- Pure function calls and type-first integer parameters have additional JS
  guest coverage.
- AttoLang-removed `%`, `^`, and `^^` operators are rejected **before
  emitting any artifact**, with a dedicated diagnostic code. The lexer-aware
  preflight ignores line comments, nested block comments and quoted text.
- Checked add/subtract/multiply overflow has JS guest-trap tests. This does not
  show Java/LLVM *failure-phase* or diagnostic parity.
- The strict compatibility gate rejects all non-scalar program-v2 constructs,
  including modules, classes, generators, booleans, ternary/conditional
  branches, ADT/match and Symbols, even where the broader Oreslang
  program-v2 dialect accepts them.
- Local `const`/type-first bindings, assignment, eager non-return statement
  evaluation, general classes/actors, ownership, async/select and hosted APIs
  remain unsupported here, and must be treated as **NOT_EXECUTED / unsupported**,
  not as a matching semantic diagnostic.

The Atto scalar contract's 19 cases are **not** reported as 19 passes. In
particular, accepting/rejecting a source file for the wrong diagnostic family
is not a pass. This path proves only the executed JS guest cases identified
in `tests/atto-scalar-v1-compat.test.mjs`. Run a compiler-produced and
guest-executed Java/LLVM comparator, with authenticated exact source SHAs and
matching diagnostic families, before asserting cross-backend parity.

Generated ESM is **trusted code**, not a sandbox. The source-local Node CI
job must execute on the PR's exact reviewed head; a queued or step-zero
GitHub Actions run is `NOT_EXECUTED`, never green proof.
