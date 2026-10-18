# Java ↔ JavaScript semantic parity: evidence and blockers

This is a **source-pinned comparison contract**, not a claim of Java/JS parity.

## What runs today

`npm run parity:js` compiles and **actually executes** five positive Oreslang
fixtures and compiles five intentional diagnostic fixtures with the experimental
JS program-v2 backend on Node 22. All ten are copied byte-for-byte from
`ores-truffle-oreslang/oreslang-source.java` under
`contracts/v1/semantics/fixtures/`, at reference revision
`e719222e2c4c8ff8eff5d3986ad1885bfc02bc7a`.

Every fixture has a pinned Git blob SHA-1 checked at runtime. The suite has an
independent deterministic SHA-256 over length-delimited case ID, kind, expected
observation, blob SHA and exact source bytes. Positive cases must return a real
`bigint` and the expected value; negative cases must fail during compilation
with a corresponding Oreslang program-v2 diagnostic class. Results include the
actual local checkout commit and Git tree (from `git rev-parse`).

The ten fixture IDs match the **subset** of Java's
`contracts/v1/semantics/cases.json`: add, precedence, forward calls, unary
minus, underscored literals, and unknown name, wrong call arity, duplicate
definition, overflowing literal, unterminated comment. No unsupported features
are silently counted as passes.

`compareJavaAndJsReports(js, graal)` accepts Java's v1.1 semantic report
shape to compare ten matching per-fixture results. It rejects missing, pending
or failed cases, duplicate IDs, wrong revision format, value/diagnostic
differences, and wrong subset identities. It **cannot authenticate** the
supplied Java report: a synthetic JSON document can satisfy its checks.
The comparison therefore always returns
`java_runner_authenticated:false`,
`source_to_binary_authenticated:false`,
`full_java_js_parity_certified:false`, even for matching records.

## Discovered substantive divergence — overflow policy

At Java reference main `e719222e2c4c8ff8eff5d3986ad1885bfc02bc7a`,
`src/main/java/dev/oreslang/nodes/OresEvalRootNode.java` implements integral
addition/subtraction/multiplication as ordinary Java `long` operations
(`x+y`, `x-y`, `x*y`), and unary minus as Java `-long`. That implementation
**wraps** on signed-64 overflow. The JS Program IR v2 lowerer currently uses
`signed-i64-checked-provisional` and throws if the result is outside signed
64-bit range. That divergence is detected in a JS-only characterization test,
not yet confirmed by executing the Java compiler and guest.

Do **not** silently retag a checked IR as wrapping, or change the Java
reference implementation without a language-semantics decision. Literal
overflow at compile time is a separate contract from arithmetic overflow at
runtime. An independently executed Java/Graal probe of
`MAX_I64 + 1`, `MIN_I64 - 1`, `MIN_I64 * -1`, unary `-MIN_I64`, and
intermediate overflow should determine the observed behavior. Decide whether
Oreslang specifies checked arithmetic or wrapping arithmetic, then align the
frontends, runtime helpers, IR semantics, tests, error taxonomy and LLVM/Wasm
lowering consistently. If two intentional policies remain, they need
**different explicit IR tags** and no silent fallback.

## Required release evidence

1. Verify Java compiler source checkout and built binary via a real GraalVM
   runner; execute the exact same fixture byte corpus, both positive and
   negative, with independent report evidence.
2. Compare the actual Java report against the JS output; authenticate run ID,
   job ID, real executed steps, SHA of checkout tree and compiler artifacts
   **outside** the self-reported JSON.
3. Execute explicit dynamic overflow probes, compare exact values/error
   classes, and resolve the policy before promoting arithmetic parity.
4. Pin TypeSpec and Draft 2020-12 authorities for the eventual **shared typed
   IR**. The current program-v2 IR is JS-backend-local and experimental.
5. Do not infer Java/JS, actor, class, ownership or full-language parity from
   a successful JS CI run or a structurally valid report.

The private cross-org Git tree mirror provides a valid route to test a
**complete, SHA-identical JS tree**. It does not by itself authorize a Java
runtime claim or prove source-to-binary provenance.
