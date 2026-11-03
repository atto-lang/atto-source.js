# JS transpiler hardening: exact-head acceptance (2026-11-01)

## Scope and non-claims

This draft hardens source/IR admission tests, adds checked signed-i64 generated-ESM
tests, and contributes 50 source-level parity candidates. It does **not**
implement unsupported Oreslang language features or prove cross-backend
semantic parity. Legacy scalar-v1 wrapping and program-v2 checked-i64
semantics remain deliberately distinct.

The candidate inventory at contracts/v1/transpiler-parity-candidates.json
includes 37 value and 13 checked-overflow expectations, each with an exact
checked-i64 source header. It is an authored corpus, not a cross-backend receipt.

## Run on an authorized Node 22 runner, in the source repository

    node --version
    git status --porcelain=v1
    git rev-parse HEAD
    git rev-parse HEAD^{tree}
    npm run parity:transpiler-receipt > /tmp/oreslang-js-parity-receipt.json
    npm run check
    npm run test:transpiler-hardening
    npm run test:core
    npm run test:core-bool
    npm run test:core-option-result
    npm run test:core-adt-conformance
    npm run test:named-args
    npm run test:program-classes
    npm run test:symbols
    npm run test:workers
    npm run parity:numeric-js
    npm test

The receipt command rejects a dirty checkout and checks Git tree/index modes,
regular-file types, non-symlink path components, and the exact physical Git
SHA-1 blob bytes of the JS compiler, strict-JSON parser, manifest and
regression inputs against committed Git blobs. It verifies these inputs
**before dynamically importing the repository-owned compiler and JSON parser**,
then imports the verified parser/compiler/IR bytes as sealed in-memory ESM\nmodules rather than reopening the files through Node's module resolver. The\ncompiler-to-IR static import is explicitly checked against the reviewed\ndependency shape. It fences HEAD/tree and rechecks physical inputs after\nexecution. This avoids the post-verification disk import window; it is not\na substitute for a protected checkout, review, or an OS sandbox. The dedicated test suite exercises a
source-local temporary Git fixture, a skip-worktree compiler mutation with a
pre-import side-effect canary, ambiguous duplicate JSON members, and dirty
candidate-source rejection. These tests run entirely inside the authorized
source runner, without any cross-organization mirror. Redirect its output outside the repository (e.g. /tmp) so
the output file cannot make the checkout dirty before execution. Its 50 per-case
observations are Node generated-ESM evidence only; no Java/LLVM/Cranelift/Wasm
or .NET guest ran. Do not substitute a host-only oracle or this receipt for
cross-backend evidence.

Before claiming success, record the exact PR head SHA, Git tree SHA, tested
compiler source blob SHA(s), test source blob SHA(s), Node version, workflow run
and attempt IDs, runner identity, required executed job steps, commands,
exit statuses, and guest output. No step = no execution = no test evidence.
A source-integrity canary or isolated host oracle is not compiler-backed guest
validation.

## Cross-backend differential contract (pending)

For each of the 50 unchanged source byte strings, perform real source-level
compile/check and guest execution independently through Java/GraalVM, LLVM,
Cranelift, Wasm, .NET NativeAOT, and JS program-v2 ESM, plus browser ESM when
supported.

Record compiler version/commit, source SHA-256, exit code, result/trap
classification, and traceable runtime output. Compare signed-i64 integers
exactly, without coercing to floating-point JS Number. Unsupported source
must be recorded as UNSUPPORTED, not PASS. The host BigInt oracle is only
supplementary expected-value checking.

For checked overflow, the JS guest uses the provisional ORES_I64_OVERFLOW
classification. Cross-toolchain comparison must normalize specified semantic
failure classes without falsely equating unrelated host exception messages.
Keep compilation error, execution trap, timeout, runner admission failure,
and guest output mismatch distinct.

## Deferred language decisions

Do not silently remove or reinterpret the legacy percent operator or signed-i64
wrapping in scalar-v1 as part of this test-only patch. The canonical Oreslang
grammar currently removes %, ^, and ^^; plan a separate compatibility
migration with all affected tests/toolchains. Never adopt JS truthiness,
JS Number coercions or JS Worker security in place of actor isolation.

Option/Result, classes, actor source lowering, suspends, non-suspending critical
bodies, ownership and closed-world module imports require separately reviewed
conformance work. Rebase dependent feature PRs bottom-of-stack first.

## Governance

Keep the PR draft until exact-head stepful CI and independent review exist.
Do not mirror private source to another org or carrier while private-source
export approvals and incident holds remain unresolved. Failed zero-step
GitHub Actions jobs are not failing compiler tests.

## 2026-11-03 audit finding

Earlier receipt code statically imported program-v2 before verifying physical
Git blobs. That ordering allowed top-level module evaluation prior to the
receipt's own admission checks. The updated source no longer does this.
The source-repository CI workflow now has explicit hardening-suite and
exact-head receipt steps; they are pending actual runner assignment.
A source-local temporary-repo test passing does **not** substitute for an
exact-head receipt from the real PR checkout or independent source review.
New AttoLang sources should use the .atto extension; these legacy compatibility
fixtures retain their existing Oreslang syntax and exact checked-i64 directive
until the frontend accepts an agreed migration profile.

## Isolated audit evidence (2026-11-03)

GitHub-fetched program-v2 and program-IR source blobs were exercised in an
isolated V8 test adapter: 50/50 reviewed numeric source candidates matched,
and 1,000/1,000 seeded signed-i64 addition pairs matched the BigInt oracle,
including 246 expected overflow traps. This is a *hosted isolated V8 run*,
not a Node 22 module-loader test, source-org CI receipt, or cross-backend
AttoLang guest parity. A local Node 22 smoke verified sealed data-URL ESM
loading using synthetic compiler/IR code, and a local Git fixture proved the
independent physical-blob preflight rejects skip-worktree modifications.

Until the source-org runner allocates and executes the exact PR head's test
steps, do not promote any of these independent checks to compiler release
acceptance. Keep the old .ores numeric fixture syntax solely for explicit
compatibility; use .atto for new AttoLang programs as the migration lands.
