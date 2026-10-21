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

## Structural typed IR → ESM (experimental, fail closed)

The `--structural-ir` CLI mode connects the typed-IR structural projection
compiler to the existing branded readonly runtime. It is a **small compiler
generated IR** profile, *not* an Oreslang `.ores` source parser or full
class/trait/interface implementation.

```sh
node bin/oreslang-jsc.mjs --structural-ir --check path/to/structural-ir.json
node bin/oreslang-jsc.mjs --structural-ir path/to/structural-ir.json --out=/absolute/path/program.mjs
```

The JSON contract requires `schemaVersion:1`, `kind:"readonly-scalar-projection"`,
a statically known record/class/struct carrier, public readonly view shape,
typed scalar slots, and a selected member. Explicit views use `mode:"explicit"`;
anonymous inline readonly record views use `mode:"inline-anonymous"` with no
redundant `structural` keyword. Source input is bounded to 256 KiB, fatal
UTF-8, BOM-rejected and strictly JSON parsed (including duplicate-key
rejection). The existing no-overwrite, no-artifact-on-rejection publication
rules apply.

The default generated ESM imports
`@oreslang/source-js/structural-runtime` from the same package scope
or an authorized browser import map.

For the **literal-only** profile, add `--portable` immediately after
`--structural-ir` to emit dependency-free, standalone ESM:

```sh
node bin/oreslang-jsc.mjs --structural-ir --portable --check path/to/structural-ir.json
node bin/oreslang-jsc.mjs --structural-ir --portable path/to/structural-ir.json --out=/absolute/path/program.mjs
```

Portable output constant-folds the selected field **after** proving readonly
structural compatibility and checking every carrier slot. Only the selected
canonical scalar literal is emitted; unused carrier values, including private
fields, do not enter the output artifact. The module exports `main()`, and
runs from an unrelated directory without this package installed. It does not
create live structural views, accept dynamic instances or provide runtime
borrow enforcement. This limitation must be revisited before nonliteral
typed IR or guest-provided runtime data can use portable emission.

In the default runtime-bound path, the selected readonly field is loaded
through a compiler-indexed primitive slot; `int` uses signed-i64 BigInt.
The generator deliberately rejects private/missing fields, mismatched
representations, mutable views, noncanonical integers, and hostile metadata.

This feature **does not** authorize guest code execution inside the host,
provide an actor security sandbox, lower generic methods/nested aggregates,
or establish GraalVM/LLVM/Wasm/.NET parity. Node and browser end-to-end
conformance must be recorded separately from source-free reference tests.

## Bounded structural Oreslang source → ESM (experimental)

Use `--structural-source` to compile **real `.ores` source**, with no
intermediate user-authored JSON. This separate opt-in dialect parses a tightly
limited subset of one optional interface/trait, one class with literal
`int`/`bool`/`string` fields, one scalar-field projection function, and
one public `main` that calls it. The returned typed IR is validated by the
same checked projection generator and branded readonly runtime as
`--structural-ir`.

```ores
define interface HasId
  id: int;
end
define class Candidate as
  pub val int id = 42;
  pub val string extra = "x";
end
fnc take(structural HasId value): int { return value.id; }
pub fnc main(): int { return take(new Candidate()); }
```

```sh
node bin/oreslang-jsc.mjs --structural-source --check program.ores
node bin/oreslang-jsc.mjs --structural-source program.ores --out=/absolute/program.mjs
```

Anonymous inline `{ id: int }`, `record{ id: int }` and
`struct{ id: int }` parameters are readonly structural by default;
the redundant `structural` prefix is also accepted for each. Named
interface/trait parameters require explicit `structural`; nominal-by-default
remains unchanged. Private fields, type mismatches, invalid i64 literals,
mutable views, `await`, actors, methods, aggregation, source injection,
and all unsupported constructs fail closed **before artifact publication**.
No general Oreslang source/compiler parity, browser worker parity, or security
sandbox is claimed. The main scalar-v1 and program-v2 CLI modes are unchanged.

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
