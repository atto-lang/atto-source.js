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

Exports from src/compiler.mjs: `compile(source)` -> ECMAScript module source text; `check(source)` -> true or exception; `compileToIR(source)` -> versioned JSON-safe scalar IR; `compileIR(ir)` -> ESM from validated IR. Compilation does not execute generated code.

**New IR seam:** the initial parser now resolves variables and function calls to numeric IR references before code generation. `src/scalar-ir.mjs` exports `validateScalarIR()` and `stringifyScalarIR()`; see [experimental scalar IR v1](docs/SCALAR_IR_V1.md) and its [JSON Schema](schemas/scalar-ir-v1.schema.json). This contract is a scalar bootstrap format, NOT the final cross-backend typed IR. Integer behavior remains provisional pending exact Java/Truffle differential execution.

## Function syntax compatibility (scalar-v1 and program-v2)

Both bootstrap parsers accept the original `pub fnc f(): int { return 42; }` spelling and new `-> int` forms with a single `return` expression, followed by `end` (optionally introduced by `as` or `::`). For example:

```ores
pub fnc answer() -> int ::
  return 42;
end
```

An arrow signature may also use `{ ... }`. These syntactic aliases do **not** add full function bodies, `void` functions, tasks, actors, async/await, classes, generic parameters, ownership lowering or nonblocking I/O. All remain unsupported and are rejected; this backend is **not** a general Oreslang transpiler. The two numeric models also remain different (scalar-v1 provisional wrapping vs program-v2 provisional checked i64), so source syntax compatibility does **not** establish semantic parity with Java/LLVM. See `tests/function-syntax-parity.test.mjs`.

## Freestanding core library (browser / Node)

The JS experimental program-v2 compiler now has a fail-closed `--freestanding-core` mode for pure `core` integer functions. It accepts the **unchanged** `oreslang-source.java/stdlib/core.ores` fixture and generates an ESM module exposing `core.min_int`, `core.max_int`, and `core.clamp_int` with exact BigInt parameters. The emitted ESM has no Node imports or browser globals; the compiler and IR validator are host-neutral.

`core` cannot depend on `std`, host I/O, timers, Web Workers or Node APIs. `alloc` is an optional explicitly admitted tier; OS-specific `std` implementations are optional target providers. Browser `std` adapters may exist, but the browser does not inherit Linux/Windows assumptions. Note: JavaScript's underlying heap/GC is allowed; freestanding is a **source dependency/effect restriction**, not a JS zero-GC claim.

Run `node bin/oreslang-jsc.mjs --freestanding-core --check tests/fixtures/freestanding-core-java.ores` and `npm run test:core`.

An experimental **closed-world core linker** is available for pure applications. A source beginning `import module core from "core";` (or legacy `"std/core"`) can call public core functions without introducing runtime imports or hosted `std` dependencies. Example: `node bin/oreslang-jsc.mjs --linked-core --core=/absolute/core.ores tests/fixtures/core-linked-app.ores --out=/tmp/ores-app.mjs`; see `npm run test:core-link`. This linker is deliberately limited to pure integer functions and exactly one supplied core source. For an in-browser ESM test serve the repo root and visit `tests/core-browser-smoke.html`. See [freestanding core and browser admission](docs/FREESTANDING_CORE_BROWSER.md). The rest of `core`, `alloc`, actor source lowering, and hosted `std` do **not** yet transpile in this experimental backend.

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

## Experimental runtime-module and match lowering (opt-in)

`node bin/oreslang-jsc.mjs --program-v2 --check path/to/program.ores` validates the new isolated scalar program dialect; `--program-v2 input.ores --out=/absolute/program.mjs` emits ESM. Its direct JS API is `compileProgramV2(source)` from `@oreslang/source-js/program-v2`. Multiple flat `define module` declarations become immutable null-prototype JS namespace objects with only public function members. File `namespace name;` is compile-time metadata and produces **no** runtime export. Exhaustive integer `match` expressions lower to one-evaluation `switch` expressions. Private member accesses and unsupported constructs are rejected.

`@oreslang/source-js/multiple-inheritance` separately offers a **method-only** inheritance planner/runtime proof: diamond deduplication, method conflicts requiring explicit overrides, public visibility/field/cycle checks, arity dispatch and nominal runtime brands. This is **not** general class transpilation: constructors, storage fields, generic views, static fields, private method dispatch, class syntax and native `instanceof` interoperability remain unsupported. Please do not confuse JavaScript mixin-order semantics with Oreslang method-slot rules.

The existing `compile(source)` and trusted-package builder intentionally remain on scalar v1; their signed-i64 wire ABI does not permit module objects. See [program v2 lowering and limitations](docs/JS_PROGRAM_V2.md). Node 22 runner evidence and Java/LLVM semantic parity are required before graduation.
