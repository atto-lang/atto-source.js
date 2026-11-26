# Java/JavaScript checked-i64 source guest corpus v1

**Status: candidate conformance, NOT independently certified across backends.**

The 15 exact LF-terminated cases in `cases.tsv` are SHA-256 pinned:
`e56dfccea11757ff18fc72a81ba5d643380e69184ab309eedf45e1e7b940e133`.
The same canonical Git blob must be present in both compiler repositories.
Seven cases return signed 64-bit values, seven must fail at runtime from
intermediate or final overflow, and one must reject a zero divisor. None
may be satisfied by returning a wrapped value, an expected-value host
stub, a skipped test or a fabricated receipt.

The guest programs are compiled from the same source declarations:
`sum`, `subtract`, `multiply`, `opposite` and `remainder`.
The Java path executes actual Graal/Truffle guest source; the JS path
compiles program-v2 source to ESM and calls the emitted guest exports.

## Profile boundaries

- Java's original unmarked `.ores` evaluator uses legacy wrapping `long`
  arithmetic; its characterization test stays intact. The **exact first-line**
  `// oreslang:checked-i64-v1` selects checked i64 execution for one source
  unit; malformed, displaced or duplicate line-comment selectors reject.
  This is not an automatic profile migration. The Java branch refuses
  cross-source imports under this profile until linked callees' source and
  integer models can be verified transitively.
- JS program-v2 already uses provisional checked i64 with or without the
  explicit directive. Legacy scalar-v1 remains a separately tagged,
  provisional wrapping compiler profile.
- Runtime exception classes differ today. `ORES_I64_OVERFLOW` and
  `ORES_I64_DIVISION_BY_ZERO` classify test outcomes; this is **not yet**
  proof of the portable guest `IntegerOverflowError` or
  `DivisionByZeroError` wire ABI, actor supervisor CONTROL panic delivery,
  source-wide strict edition admission, or Native Image AOT parity.
- Generated JS ESM and Node Workers are **trusted-code execution**, not
  secure untrusted TenantVM isolation.

## Real tests and provenance

Java:
`mvn -B -ntp -Dtest=AttoCheckedI64ProfileTest,GraalI64RuntimeCharacterizationTest -DfailIfNoTests=true test`

JavaScript:
`node --test tests/checked-i64-java-js-v1.test.mjs tests/checked-i64-arithmetic-differential.test.mjs tests/checked-i64-source-header.test.mjs`

Every run must identify its exact checked-out Git commit, tree, fixture
blob and compiled guest; zero executed steps, synthetic inputs or an
attested-looking JSON report are **NOT_EXECUTED**, not passes. Independent
run/job and binary provenance is required before cross-backend
certification. The fixture SHA-256 can be verified locally without
claiming the compiler has run.

Companion draft PRs: [Java #66](https://github.com/atto-lang/atto-source.java/pull/66)
and [JavaScript #69](https://github.com/atto-lang/atto-source.js/pull/69).
