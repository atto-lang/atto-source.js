> **AI agent instructions (organization-wide):** Before working on code, issues, or pull requests, read and follow the [organization `AGENTS.md`](https://github.com/ores-truffle-oreslang/.github/blob/main/AGENTS.md), including its **merge-first stealth-development policy**. Honor any repository-local `AGENTS.md`, explicit holds, and GitHub-enforced rules.

# AttoLang JavaScript ESM backend (legacy Oreslang checkout)

## AttoLang migration and authoritative language contracts (2026-11-18)

**AttoLang** is the current language name (**formerly Oreslang**). This `ores-truffle-oreslang/oreslang-source.js` repository retains the historical name and implementation context; the AttoLang-named counterpart is **[atto-lang/atto-source.js](https://github.com/atto-lang/atto-source.js)**, the destination for new AttoLang development. This legacy JS-to-ESM backend is NOT the Rust-to-Wasm browser compiler and is NOT an untrusted-code sandbox. Keep those execution boundaries explicit when migrating.

The **[atto-spec](https://github.com/atto-lang/atto-spec)** repository now owns normative language syntax and semantics, rather than this backend README, the old Oreslang repository names, or Java/Truffle behavior alone. Portable, positive **and negative** language tests belong in [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance); compare implementations via [atto-compilers-parity-testing](https://github.com/atto-lang/atto-compilers-parity-testing). [atto-common-source](https://github.com/atto-lang/atto-common-source) owns portable `.atto` libraries. Backend-specific compiler code stays in its corresponding `atto-source.*` repository.

**Current source-design directions (targets, not claims this backend implements them):** canonical `.atto` for new portable source, `snake_case` function/method names, ownership operations `borrow!`, `take!`, `share!`, `copy!`, and `copy!!`; [implicit borrowing for nonprimitive arguments](https://github.com/atto-lang/atto-spec/blob/main/language/implicit-argument-borrow-v1.md) is still a design target subject to compiler verification. [File/module `define const`](https://github.com/atto-lang/atto-spec/blob/main/language/file-module-const-v1.md) supports proposed constexpr values **and** non-throwing, one-time runtime `os.read_env` initialization. [The proposed operator contract](https://github.com/atto-lang/atto-spec/blob/main/language/bitwise-and-stream-operators-v1.md) uses `<<<`, `>>>`, and `ashr` for shifts and reserves `<<`/`>>` for directional stream I/O; it is **not** automatically supported by legacy backends. [Shared ownership](https://github.com/atto-lang/atto-spec/blob/main/language/shared-ownership-and-guards-v1.md) does not grant unsynchronized mutable aliasing. Check spec documents for proposal/admission status before changing a parser or example.

**Compatibility and verification:** Keep existing `.ores` fixtures, `oreslang-*` commands, package IDs, fixed ABIs, and wire identifiers wherever still used; an AttoLang name change alone does not prove that a renamed CLI, syntax form, AOT target, actor isolation, zero-GC runtime or guest feature works. Retain exact legacy commands below when they describe this checkout. Do not use Python for project scripts, tests, CI helpers or tooling; use Rust for supporting tooling/tests where practical, without misrepresenting the backend implementation language. Record source commit/tree, target/toolchain, real positive/negative **compiled guest execution**, and `passed`/`failed`/`unsupported`/`not executed` for every claimed parity result. Host-only tests or workflows with zero executed steps are **not** compiler parity evidence.

**Role:** Experimental Atto/Ores-to-**JavaScript ESM** transpiler, not a WebAssembly compiler. Its browser Web Workers and Node worker_threads execute **trusted JS handlers or compiled scalar ESM**, not Wasmtime and not fully compiler-lowered `define actor` semantics. The `/play/` compiler is `atto-lang/atto-source.rs` (Rust built to Wasm32). See [JS vs Wasm tenant architecture](docs/JS_VS_WASM_TENANT_ARCHITECTURE.md).

Experimental source-to-ESM compiler for Oreslang, intended ultimately for browser/edge JavaScript and the iso-lattes execution host.

Implemented first slice: integer functions with typed int parameters, return-only bodies, operators +, -, *, and %, forward/same-module calls, pub exports, optional module wrapper, lexical comments and bounded source. Unsupported features fail closed. The canonical language contract is atto-spec, and Java/Truffle is a reference implementation where verified; this is **not** feature parity.

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

## Browser and Node.js ESM + experimental Worker actors

The scalar/program-v2 transpiler emits ESM that can be imported in Node and browsers. This repository now includes a **trusted-host serial Worker reference**: `spawnNodeActor()` uses Node `worker_threads` and `spawnBrowserActor()` uses browser module Web Workers. A transpiled public scalar function can execute in either Worker using `mode:'call'`; ordinary trusted JS handlers require explicit `self.respond()` and `self.done()`.

This does **not** implement Oreslang `define actor` lowering or actor ownership/isolation parity. Neither JS Workers nor Wasm's existing host-side actor reference constitute an untrusted JS sandbox. See [JS vs Wasm and browser/Node test instructions](docs/JS_BROWSER_NODE_WORKERS.md), `tests/worker-node.test.mjs`, and `tests/browser-worker-smoke.html`.

## Freestanding core library (browser / Node)

The JS experimental program-v2 compiler now has a fail-closed `--freestanding-core` mode for pure `core` integer functions. It accepts the **unchanged** `oreslang-source.java/stdlib/core.ores` fixture and generates an ESM module exposing `core.min_int`, `core.max_int`, and `core.clamp_int` with exact BigInt parameters. The emitted ESM has no Node imports or browser globals; the compiler and IR validator are host-neutral.

`core` cannot depend on `std`, host I/O, timers, Web Workers or Node APIs. `alloc` is an optional explicitly admitted tier; OS-specific `std` implementations are optional target providers. Browser `std` adapters may exist, but the browser does not inherit Linux/Windows assumptions. Note: JavaScript's underlying heap/GC is allowed; freestanding is a **source dependency/effect restriction**, not a JS zero-GC claim.

Run `node bin/oreslang-jsc.mjs --freestanding-core --check tests/fixtures/freestanding-core-java.ores` and `npm run test:core`.

An experimental **closed-world core linker** is available for pure applications. A source beginning `import module core from "core";` (or legacy `"std/core"`) can call public core functions without introducing runtime imports or hosted `std` dependencies. Example: `node bin/oreslang-jsc.mjs --linked-core --core=/absolute/core.ores tests/fixtures/core-linked-app.ores --out=/tmp/ores-app.mjs`; see `npm run test:core-link`. This linker is deliberately limited to pure integer functions and exactly one supplied core source. For an in-browser ESM test, run `npm run serve:browser` (Node-only development server, no Python) and visit `http://127.0.0.1:8000/tests/core-browser-smoke.html`. See [freestanding core and browser admission](docs/FREESTANDING_CORE_BROWSER.md). The rest of `core`, `alloc`, actor source lowering, and hosted `std` do **not** yet transpile in this experimental backend.

## Typed boolean core subset

The experimental program-v2 and `--freestanding-core` backend now also support first-class `bool`: typed params/results, `true`/`false` literals, `!`, int comparisons producing bool, boolean function calls, and boolean `if` guards. Unlike JavaScript, Oreslang accepts **only** `true`/`false` at a boolean ABI. An integer is never treated as truthy. Legacy integer-only IR and the emitted ESM for the existing authoritative `core.ores` remain unchanged.

Run `npm run test:core-bool`; the browser ESM smoke also covers pure boolean compilation. The source is still an **experimental narrow subset**: `Option`/`Result`, records, full comparison/equality generics, and actor declarations are not yet supported.

## Typed word operators (experimental program-v2)

Program-v2 supports `eq` and `neq` as source aliases for typed `==` and `!=` (including nominal `Symbol` equality), plus `not`, `and` and `or` for strict `bool` values. Precedence is unary `not`, arithmetic, comparison, `and`, `or`, then the conditional `? :`; parentheses override precedence. `and` and `or` short-circuit their right operand, including checked-i64 overflow and remainder traps, by lowering into the existing validated lazy conditional IR. No JavaScript truthiness, host-side coercions, effectful calls, or new IR operators are admitted. The scalar-v1 profile is intentionally unchanged.

Run `node --test tests/boolean-word-operators.test.mjs` to exercise the source, canonical IR, generated ESM, freestanding core and class-method paths. These are experimental syntax extensions, not full Java/LLVM semantic parity.

## Symbol literals (experimental program-v2)

The typed program-v2 subset now accepts nominal `Symbol` parameters/results and strict PROCESS Symbol literals such as `#ready` and `#"http.ok"`. Names use Java-aligned pre-normalization/UTF-8 budgets and NFC/control/bidi validation. Generated values are fresh/non-interned and artifact-branded; forged host objects do not satisfy the Symbol ABI. Typed `==`/`!=` use logical `(kind,name)` equality rather than JavaScript object identity.

Symbol-using generated ESM also exports the reserved host bridge `"@oreslang/symbol-wire-v1"`. Its `encode` method converts an artifact-branded Symbol to the portable exact-field wire `{"$symbol":"process"|"stable","name":"..."}`; `decode` validates canonical NFC/UUID/bounds and rebrands the value for the receiving artifact. The optional `"untrusted-core"` admission mode allows only PROCESS `ready`, `error`, and `Symbol.iterator`. The standalone `@oreslang/source-js/symbol-wire-v1` module additionally provides strict JSON parsing with duplicate-member rejection. Run `npm run test:symbols` and `npm run test:symbol-wire`.

Stable UUID Symbols are wire-decodable but still have no source constructor/literal in this JS slice. Symbol-keyed collections/records, declaration/export manifests, tenant-scoped userland admission, and actor transport remain explicitly unsupported.

## Fieldless classes and typed method calls (experimental program-v2)

Program-v2 now contains the migration path for the bounded class-method semantics previously isolated in the class-method prototype. Root-level `define class`, `pub define class`, and `define pub class` declarations lower into the same resolved program IR as functions/modules. A leading declaration-level `self` is erased from caller-visible arity, so `foo()` and `foo(self)` collide as the same `foo/0` slot. Contextual `mtd`/`method` markers and the Java-compatible callable keyword names remain supported.

The first source-call form is deliberately narrow and Java-aligned: `new Box().pick(...)`. Fieldless construction has arity zero. Positional and named method arguments reuse the exact same declaration-name binder and source-order-preserving permutation model as free functions, e.g. `new Box().pick(b: 2, a: 1)`. Method parameters/results may use the current program-v2 scalar domains, including `Symbol`; Symbol equality inside methods reuses the same logical `(kind,name)` semantics.

Generated classes retain the prototype hardening proven by the standalone class-method prototype: private receiver brand checks, immutable constructor/prototype, non-extensible instances, constructor arity checks, and rejection of foreign JS subclassing. Private methods are not externally callable.

This convergence slice still has **no fields, inheritance, constructors with source parameters, local class variables, class-valued parameters/results, generic methods, actor methods, ownership/borrowing, or arbitrary method call graphs**. Method bodies may use scalar/boolean/Symbol expressions, conditionals and portable Option/Result intrinsics; nested class construction, free-function calls, method calls and match inside method bodies fail closed for now. Run `npm run test:program-classes`.

Legacy class-free program-v2 IR and generated ESM remain byte-stable: the optional `classes` IR field is emitted only when a class is actually present. The historical `--class-methods-v1` CLI and `@oreslang/source-js/class-methods-v1` API are retained as narrow compatibility adapters over this unified path; they intentionally reject richer program-v2 class features.

## Named arguments (experimental program-v2)

Ordinary program-v2 function/module calls can bind exact-arity arguments by formal name, with positional arguments only before named ones. For example, `mix(1, c: 3, b: 2)` binds to `(a,b,c)` while preserving lexical expression evaluation order. The resolved `namedCall` IR carries an explicit source-to-formal permutation and validates it before ESM emission. Unknown/duplicate/missing labels and named portable intrinsics reject. Run `npm run test:named-args`.

Optional/omittable parameters, defaults, varargs and `omit`/`_` are **not** enabled by this slice. Named method calls reuse this binder only for the bounded fieldless-class profile described above.

## Canonical conditional syntax (experimental program-v2)

In opt-in `--program-v2` source, `if condition then ... else ... fi` is **statement-only** and requires explicit returns on all paths. Pure scalar value selection uses lazy, right-associative `condition ? whenTrue : whenFalse`, with strictly boolean conditions (no JS truthiness) and statically compatible `int` or `bool` branches. The earlier `if condition; do ... fi` remains an accepted bootstrap compatibility spelling. `return if ... fi` remains invalid. Internal program IR reuses its existing typed `if` variant; no general actor/class/ownership feature is implied. Run `npm run test:conditionals`. This is only a limited Java/Graal syntax-alignment slice, not full parity.

## Select runtime substrate

The JS runtime now has a source-independent `SelectArbiter` for future
compiler-lowered static select. Within one JavaScript isolate/runtime lane it
provides exactly-one winner publication, late-arm loser revocation,
cancellation handles, synchronous conditional commit, reentrancy rejection,
and cleanup-failure capture.

This is not cross-Worker shared-memory arbitration and it does **not** enable
source `select`, channels, Future selection, or actor continuation lowering.
Commit callbacks are trusted runtime primitives and must be bounded,
synchronous, and return a boolean; Promise/thenable commits fail closed. Source
select remains rejected until the missing channel/Future/actor layers exist.

### Selectable i64 channel substrate

Stacked on the JS `SelectArbiter`, the runtime now has a bounded signed-i64
`SelectableI64Channel` proof. It uses revocable readable/writable readiness
subscriptions, conditional read/write commits, stale-subscription identity
checks, post-commit notification dispatch, and signed-i64 `BigInt` validation.
A losing selected read cannot consume and a losing selected write cannot
publish.

The channel substrate now also models close as a terminal readiness event:
buffered values drain before EOF, an empty closed channel commits selectable
EOF, and a selected write against a closed channel terminates as closed without
publishing. This remains a one-isolate runtime substrate, not source
`Channel<T>` or cross-Worker channel support. Future arms, actor continuations,
suspension and compiler lowering remain pending.

## Security boundary

This is a code generator, **not a sandbox**. An ES module, Node worker thread or Node vm context is not a secure boundary for malicious guests. Only bundle the generated JS as a trusted artifact. This backend still has **no compiler-lowered Oreslang actor runtime** or enforced actor capability/ownership model. The experimental Worker reference is only for trusted host handlers and synchronous transpiled function calls. General native pointers, Oreslang async/await, channels, objects, collections, exceptions, and host I/O remain unsupported in the language compiler. Do not promote it to an untrusted host.

Static `select` fails closed with a dedicated capability diagnostic in both scalar-v1 and `program-v2` (and therefore in freestanding/class-method source paths that delegate through `program-v2`). Both `{ ... }` and `over ... end` forms remain disabled until checked Channel/Future arbitration, actor-lane continuation scheduling, ownership transfer, and cancellation lowering exist. Rejected select source must not produce a JavaScript artifact.

## iso-lattes integration

Use a pinned Oreslang source revision, compile before deployment, inspect/build a trusted ESM bundle, and load exported public entrypoints inside the explicitly trusted iso-lattes host. Do not eval arbitrary guest source. A separate security-reviewed host adapter is required before claiming arbitrary Oreslang guest support.

## Cross-backend tests

The arithmetic and forward-call cases follow the common Oreslang source parity slice; the negative unresolved symbol check follows the platform-conformance negative fixture. Adding backend js to the shared conformance inventory is still necessary and must report real, exact-commit runs, not a fake or skipped pass.

See docs/NEXT_STEPS.md.

## Trusted JS host package and ABI

The source.js backend can now emit a prebuilt `module.mjs` plus a SHA-256 manifest for the `browser` and `edge-js` target profiles using `buildPackage()`. A portable `invokeTrustedModule()` bridge requires explicit entrypoint allowlisting and JSON-safe canonical signed i64 decimal arguments/results. The source compiler is separately bounded against very large numeric literals and expression-lowering recursion.

See [the experimental iso-lattes host contract](docs/ISO_LATTES_HOST_ABI.md) for build and invocation examples, limitations, provenance policy, and required host integration gates. This is **not** yet execution inside iso-lattes: we have not verified its repository or API. The adapter only accepts trusted, already-imported ESM modules and provides no OS or JS sandbox.

## Experimental runtime-module and match lowering (opt-in)

`node bin/oreslang-jsc.mjs --program-v2 --check path/to/program.ores` validates the new isolated scalar program dialect; `--program-v2 input.ores --out=/absolute/program.mjs` emits ESM. Its direct JS API is `compileProgramV2(source)` from `@oreslang/source-js/program-v2`. Multiple flat `define module` declarations become immutable null-prototype JS namespace objects with only public function members; the same profile now also admits the bounded root-level fieldless classes described above. File `namespace name;` is compile-time metadata and produces **no** runtime export. Exhaustive integer `match` expressions lower to one-evaluation `switch` expressions. Private member accesses and unsupported constructs are rejected.

`@oreslang/source-js/multiple-inheritance` separately offers a **method-only** inheritance planner/runtime proof: diamond deduplication, method conflicts requiring explicit overrides, public visibility/field/cycle checks, arity dispatch and nominal runtime brands. This is **not** general class transpilation: constructors, storage fields, generic views, static fields, private method dispatch, class syntax and native `instanceof` interoperability remain unsupported. Please do not confuse JavaScript mixin-order semantics with Oreslang method-slot rules.

The existing `compile(source)` and trusted-package builder intentionally remain on scalar v1; their signed-i64 wire ABI does not permit module objects. See [program v2 lowering and limitations](docs/JS_PROGRAM_V2.md). Node 22 runner evidence and Java/LLVM semantic parity are required before graduation.

## Development policy: no Python

Python is prohibited in this repository for source code, tests, build tooling, code generation, CI, and automation. Existing Python code must be replaced with behavior-equivalent Rust and equivalent regression coverage before removal. Do not add Python source/notebooks, Python dependency manifests, `python`/`python3`, `pip`, `pytest`, `poetry`, `uv`, or Python setup actions. Rust tooling must pass `cargo fmt`, `cargo clippy -- -D warnings`, and `cargo test`.


## Concrete Option/Result and exhaustive ADT matching (integration draft)

The opt-in program-v2 source compiler admits only portable `Option<int>` and `Result<int,int>` values, strict frozen null-prototype tagged-data checks, and exhaustive `Some/None` and `Ok/Err` expression matching with arm-local typed payload bindings. This is not general generics, capabilities, actor-source lowering or general exception support. Run `npm run test:core-option-result`, `npm run test:core-adt-match` and `npm run test:core-adt-conformance`. Exact-head Node/browser tests and independent review remain required.

## Shared six-backend scalar50 source execution (experimental JS evidence)

`npm run test:shared-scalar50` compiles and executes the **exact 50 source programs**
from the Java/LLVM/Wasm/Cranelift/.NET scalar50 conformance proposal, using
program-v2 and the actual Node ESM loader. The checked-in
`tests/fixtures/shared-scalar50-v1.tsv` is byte-identical to Java PR #2386's
`contracts/parity/scalar50/v1.tsv` at commit
`9371ba965e6d05ce2e4e934eb0cbf906a813dd9f`, Git blob
`a948dbaf594916a6ee07f65d49a0cf5ae398ca7b`. The test rejects any
physical-byte change and verifies 50 typed BigInt results plus source-to-IR
codegen identity. The default `npm test` also includes this test file.

This is a small shared scalar source floor, **not** compiler or actor parity.
The suite does not execute Java/Graal, LLVM, Cranelift, Wasm, or .NET; their
respective real compiler/guest tests need separate exact-head receipts. The
shipping JS scalar-v1 compiler still wraps provisionally while program-v2
checks signed-i64 overflow. The additional negative test ensures this suite
does not accidentally promote wrapping to checked arithmetic. Node's ESM
runtime is not an untrusted guest sandbox. A passing source-free or in-memory
V8 test is not an executed Node `npm test` or CI admission receipt.

## Legacy repository scope and contribution routing (2026-11-18)

**Historical checkout:** `ores-truffle-oreslang/oreslang-source.js`. **AttoLang destination:** [`atto-lang/atto-source.js`](https://github.com/atto-lang/atto-source.js).

**Scope:** JavaScript ESM transpilation and trusted browser/Node worker integration. The historical repository and new counterpart may not contain identical commits, pull requests, issues, or artifacts; a same-suffix repo is not proof of an in-place GitHub ownership transfer or identical Git history. Compare exact SHAs and migrate outstanding work deliberately; open new AttoLang design changes against [atto-spec](https://github.com/atto-lang/atto-spec) and new backend work in the appropriate AttoLang repository. The former plan to transfer `oreslang-source.js` under its unchanged legacy name is superseded as a naming destination by `atto-source.js` (without implying the old GitHub repository itself has moved).

Keep the [historical organization migration tracker](https://github.com/ores-truffle-oreslang/.github/issues/26) and [review runbook](https://github.com/ores-truffle-oreslang/.github/pull/25) for migration/security context, not as proof of a completed transfer. Preserve access controls, private source provenance, branch protections, PR/issue history and CI evidence; do not assume an existing `atto-*` repository is a verified byte-for-byte transfer. Host-only or source-free canaries do not prove guest code execution or parity.

