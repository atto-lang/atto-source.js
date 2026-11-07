# AttoLang final-ESM cross-backend candidate corpus (v1)

This directory contains `cases.json`, a **97-case proposed observation contract** for the bounded JS `--program-v2` compiler profile, intended to be independently executed by Java/GraalVM and LLVM compiler-backed guests. The shared source does **not** imply matching semantics, and the contract does not assert that either native backend passed the cases.

## Corpus provenance and exact source bytes

- **17 reference cases** reproduce the exact `.ores` source bytes of LLVM `contracts/v1/semantics/fixtures/oresllm-*.ores` at pinned LLVM main commit `15bdd5cc48cf64387aee7e19f2926c253eb10e08` (tree `3754a4d0da917a4862b5f3fee2fa9228e9427e44`). Each case supplies its exact Git blob SHA-1 and the corresponding reference manifest's expected exit `42`. The references are semantic inputs, **not verified LLVM execution receipts**.
- **80 deterministic generated candidates** cover 16 operand pairs across five operation families: add, subtract, multiply, remainder, and left-associated subtraction. The signed-i64 checked-provisional independent BigInt oracle recomputes each expected value or error class, including per-node intermediate overflow and zero divisors. A backend implementing wrapping arithmetic must not report these checked-policy probes as matching unless its explicit checked-source mode is actually used.
- No cases promote `%` to a settled AttoLang language-standard operator; it is an existing experimental program-v2 regression only.

The Node test `tests/final-esm-native-source-97-20261107.test.mjs` validates corpus cardinality, source IDs, Git blobs, operand identity, independently computed oracle outcomes, then compiles, checks the *final* ESM under Node, executes it and observes actual output/traps. It compares source compilation to JSON-round-tripped typed IR compilation byte-for-byte.

## Required independent native evidence

For each candidate case, Java/GraalVM and LLVM must independently:

1. Record exact compiler source head/tree, immutable source text hash, compiler artifact hash and immutable workflow run ID/job ID/run attempt.
2. Prove the **actual** guest compiled and ran: runner assigned, executed steps nonempty, exit/trap trace captured and associated with case ID.
3. Report numeric mode as `signed-i64-checked-provisional` only if that mode is truly implemented; otherwise mark the checked-policy observation `NOT_EXECUTED` or `SEMANTIC_DIVERGENCE`, never coerce wrapped values into checked results.
4. Compare **observed** typed value or portable error category and evaluation order with the corpus's proposed observation. A literal expected exit in the corpus is not a native execution receipt.

Do not modify `cases.json` to disguise a mismatch; update language decisions and backend lowering separately, and preserve the original reference source hashes. Do not mirror private sources outside the organization or relax CODEOWNERS / independent review to unblock these tests.

## Local JS test entrypoint

```sh
npm run test:final-esm
npm test
npm run parity:js
npm run parity:numeric-js
```

**Evidence at authoring:** source and Node 22 tests committed for review; hosted exact-head Node execution pending. Existing GitHub Actions jobs show `steps=null` and therefore fail runner admission. This document and manifest contain no native verification claims.

## Independent corpus acceptance gate (2026-11-07)

The emitted-ESM receipt MUST first execute `verifyFinalEsmCorpus()` from `scripts/final-esm-corpus-guard.mjs`. Unlike a manifest self-check, this guard holds the 17 original LLVM Git blob SHA-1 values, exact LLVM reference commit/tree identity, generated input schedule, and arithmetic oracle **outside** `cases.json`. It recomputes the 80 generated checked-i64 expected values/traps, validates per-operation intermediate overflow, and rejects altered source text, noncanonical operand text, duplicate IDs, swapped sources, silently changed numeric modes, or spoofed backend evidence. Native reference cases must continue to expect the canonical exit code 42; this is **not** an assertion that LLVM guest execution actually happened.

`npm run test:corpus-integrity` executes the source-only acceptance test and **31 negative manifest mutations**, including an attempted fraud where a changed LLVM source is paired with a freshly recomputed self-consistent Git blob SHA-1. The pinned external-source digest must still reject it. `npm run test:final-esm` includes these cases, and the source CI workflow names a separate early integrity gate before any 97-case guest execution receipt. The guard additionally admits only exact own-data keys for each corpus, case, source-origin, oracle and expected-result record; it rejects forged run/status siblings, accessor properties and nonplain prototypes. The receipt also hashes the guard's own source file before execution and verifies it has not changed before publication.

These negative tests and the verifier are source-local artifacts **authored for execution**, not evidence of passing hosted CI. A healthy exact-head source-org GitHub Actions runner with nonempty executed steps is still mandatory to certify runtime behavior.
