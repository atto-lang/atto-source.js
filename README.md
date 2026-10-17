# Oreslang JavaScript backend

Experimental source-to-ESM compiler for Oreslang, intended ultimately for browser/edge JavaScript and the iso-lattes execution host.

Implemented first slice: integer functions with typed int parameters, return-only bodies, operators +, -, *, and %, forward/same-module calls, pub exports, optional module wrapper, lexical comments and bounded source. Unsupported features fail closed. The Java/Truffle frontend is the language reference; this is **not** feature parity.

## Quick start

Requires Node.js 22 or later; no third-party runtime dependencies.

    npm test
    node bin/oreslang-jsc.mjs --check tests/fixtures/arithmetic.ores
    node bin/oreslang-jsc.mjs tests/fixtures/forward-call.ores --out=/tmp/forward.mjs
    node -e 'import("/tmp/forward.mjs").then(m => console.log(m.main()))'

The compiled main() returns 42n (BigInt). Numeric behavior uses **provisional** signed 64-bit wrapping; Java semantic parity is unverified. Division remains unsupported in this int-only slice because the Java reference types int/int division as float. Integer remainder (%) follows signed-i64 Java long semantics; other unsupported operations are rejected rather than guessed.

Exports from src/compiler.mjs: compile(source) -> ECMAScript module source text; check(source) -> true or exception. Compilation does not execute generated code.

## Security boundary

This is a code generator, **not a sandbox**. An ES module, Node worker thread or Node vm context is not a secure boundary for malicious guests. Only bundle the generated JS as a trusted artifact. This backend currently has no actor runtime, capability enforcement, process isolation, native pointers, async/await, channels, objects, collections, exceptions or host I/O. Do not promote it to an untrusted host.

## iso-lattes integration

Use a pinned Oreslang source revision, compile before deployment, inspect/build a trusted ESM bundle, and load exported public entrypoints inside the explicitly trusted iso-lattes host. Do not eval arbitrary guest source. A separate security-reviewed host adapter is required before claiming arbitrary Oreslang guest support.

## Cross-backend tests

The arithmetic and forward-call cases follow the common Oreslang source parity slice; the negative unresolved symbol check follows the platform-conformance negative fixture. Adding backend js to the shared conformance inventory is still necessary and must report real, exact-commit runs, not a fake or skipped pass.

See docs/NEXT_STEPS.md.

## Trusted JS host package and ABI

The source.js backend can now emit a prebuilt `module.mjs` plus a SHA-256 manifest for the `browser` and `edge-js` target profiles using `buildPackage()`. A portable `invokeTrustedModule()` bridge requires explicit entrypoint allowlisting and JSON-safe canonical signed i64 decimal arguments/results. The source compiler is separately bounded against very large numeric literals and expression-lowering recursion.

See [the experimental iso-lattes host contract](docs/ISO_LATTES_HOST_ABI.md) for build and invocation examples, limitations, provenance policy, and required host integration gates. This is **not** yet execution inside iso-lattes: we have not verified its repository or API. The adapter only accepts trusted, already-imported ESM modules and provides no OS or JS sandbox.
