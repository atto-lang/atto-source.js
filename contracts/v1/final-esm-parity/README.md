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
