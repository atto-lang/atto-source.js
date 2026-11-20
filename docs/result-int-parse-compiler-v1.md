# JS Worker checked Result<int,Error> source-compiled subset v1

A real Atto source frontend now recognizes the narrow parse_id example:
one function of type string -> Result<int,Error> using int.parse(...)?
and one main returning a match on Ok(value)/Err(). It emits static JS Worker
code from a fully parsed and validated AST; arbitrary source text is NEVER
interpolated into the generated module. The source string literal is quoted
using JSON.stringify. Results are frozen tagged records. Invalid decimal
input returns a newly allocated immutable Error; '?' propagates the exact
same Err record. No optional JS exception is caught as a source Err.

Bounded ASCII signed-i64 decimal parsing uses BigInt for precise overflow,
with 1..1024 UTF-8 bytes; malformed and out-of-range return Err. Each
create_tenant call creates its own single-use main closure; tenant state
is not shared between guests in this subset.

This is a **TRUSTED JS WORKER PROFILE**, not an untrusted multi-tenant
same-process isolation proof, not a generic Result/Option compiler,
and not trap/throw/raise/panic/defer/recover parity. Source syntax outside
the proven grammar fails closed. Spec candidate atto-spec #124, shared
conformance #68, tracker #20. Tests transpile real Atto source into JS
module code and execute it; only exact-head successful CI can certify
this new candidate. No public /play binary or release pin is changed.

## Byte-exact canonical guest conformance targets

`tests/fixtures/trap-result-v1/parse-id-ok.atto` and `parse-id-invalid.atto` are copied unchanged from [atto-platform-conformance #68](https://github.com/atto-lang/atto-platform-conformance/pull/68) at source commit `e1164c269fc61726ff58a05003d2311a3f7d1f31`. The local test checks the exact original Git **blob** SHAs (`41b7dfd0…`, `3a43c445…`), transpiles the unchanged source with this compiler, imports the generated module as executable JavaScript, and checks each target exit outcome in two distinct tenant-scoped, one-shot guest instances.

A separate isolated V8 validation of the PR code at head `3437f9b68f63da304f6b4984160a518ccad688b0` executed 26 focused pass/reject/edge cases and both canonical byte-exact source fixtures successfully. It used a minimal TextEncoder polyfill in the test isolate and did **not** execute Node Workers or GitHub Actions. This local verification must not be entered as a certified multi-backend CI receipt. Real exact-head Node suite and security audit remain mandatory.

## Audited alternative Result function forms
The restricted trusted Worker profile additionally accepts `val n: int = int.parse(text)?; return Ok(n);` and direct `return int.parse(text);` when the function's return type is `Result<int,Error>`. The direct path retains the original tagged Result without allocating a new Ok wrapper. Invalid annotations and a raw `?` returned from a Result-typed function fail closed. These are source-generated JS guest candidate features, not general ADT, trap or TenantVM parity. Local V8 checks are not a GitHub Actions receipt.

## Statement-style match, bounded integer guards
The candidate compiler now admits `match int.parse(text) over ... end` with exhaustive `Ok`/`Err` braced arms. Each arm must return a signed integer literal or (for a bound `Ok(n)` only) a single `if n eq <signed-i64> then return <int>; else return <int>; fi`. It never interpolates arbitrary guest expression source into JS; all numeric literals are parsed and range-checked before code generation. Unsupported control flow, non-exhaustive arms, unknown guard binders, and guard access to Error values fail closed. Eight original byte-identical `atto-platform-conformance` fixture blobs and their SHA-1 pins are included in the canonical guest suite. Local V8 proof is not a certified Node Worker/GitHub Actions receipt.
