# Portable compile-time `core` import for browser and Node

This is an experimental **pure integer source subset** feature, stacked on PR #28 (the freestanding core implementation). It is **not** a general library/package resolver and does not implement all of Oreslang `core`, `alloc`, `std`, or actors.

## Why this exists

`core` is an **environment-agnostic** library tier. `core` must not require an OS, clock, heap allocator, thread pool, Node builtin, DOM API, filesystem, network, dynamic runtime module loader, reflection, or FFI. The JavaScript backend uses the host's ordinary BigInt and JS-managed GC to implement pure math; this does **not** grant language-level heap/host capabilities to the source.

`std` is separately admitted and can offer POSIX, Windows, Node, browser or WASI implementations. The browser has no default POSIX filesystem/process service. Browser Web Workers and Node worker_threads are separate **actor host adapters**, not part of `core`.

## Executable example

```ores
import module core from "atto.core/numeric";
pub fnc bounded(int value): int {return core.clamp_int(value,0,10);}
```

Provide a **trusted, explicit exact source** for `core`. The bootstrap accepts only this first non-comment import, using closed canonical names `"atto.core/numeric"` or `"atto.core/numeric.atto"`. Legacy `"core"` and `"std/core"` are source-only aliases for the **same** compiler-owned integer subset, never Node or browser module paths. The local import binding must still be named `core`; the generic canonical module resolver is not implemented. It resolves `core.min_int`, `core.max_int`, and `core.clamp_int` at build time against the supplied source, applies the normal program-v2 arity/visibility and checked-i64 rules, and emits one ESM artifact with **no runtime imports**.

The shipped test fixture is the unmodified authoritative `oreslang-source.java/stdlib/core.ores` blob at Git SHA `d2cd9b8e0cd3e3bb3ee6a5f9cebf9ab3312c44f4`. Production builds must pin and authenticate their input sources separately: this bootstrap API does not prove source authenticity and must not compile arbitrary untrusted input inside a production browser.

### Node

```sh
node bin/oreslang-jsc.mjs --core-linked \
  tests/fixtures/core-import-main.ores \
  --core-source="$(pwd)/tests/fixtures/freestanding-core-java.ores" \
  --out=/tmp/ores-linked-core.mjs
node -e 'import("file:///tmp/ores-linked-core.mjs").then(m => console.log(m.bounded(15n)))'
npm run test:core-linked
```

The CLI reuses bounded UTF-8 decoding, no-final-symlink source opening, and no-clobber atomic output publishing. It requires the `--core-source=` argument to be an absolute path and refuses implicit source discovery; `--check` supports the same explicit core source without output.

### Browser

Serve the repository root using local HTTP(S). Open `tests/core-linked-browser-smoke.html`. The test fetches its own two local source fixtures, calls `compileCoreLinkedProgram(appSource,coreSource)`, imports trusted generated Blob ESM, and evaluates bound operations. It prints `PASS_BROWSER_CORE_LINKED` only if those pass. The browser smoke can also be run via:

```sh
npm run test:core-linked-browser
```

That command requires a **real Chrome module** with Node 22+ CDP support, and its success is mandatory before an in-browser execution claim; zero-step GitHub Actions failures are not valid test evidence.

## Scope, limits and admission gates

- No implicit global `core`, host loads, dynamic imports, provider grants, filesystem reads or transferable/borrowed actor memory in emitted ESM.
- The compiler rejects wrong or repeated imports, unknown modules, private cross-module call attempts, undeclared host calls, non-integer types, cycles and unsupported effects.
- The core source and entire linked program are parsed and type-admitted before emitting JS. `core` is independently validated as a pure module, and the linked program has no host imports in this dialect.
- Link-time concatenation is a **temporary parser bridge**. It changes source line positions and accepts exactly one explicit static import; package resolution, source maps, namespace imports, canonical typed-IR linking, full provenance checks and multi-module compilation are outstanding.
- The **canonical frontend** should eventually produce typed IR with library-tier/effect metadata and authenticated dependency closure, reused across Java/GraalVM, LLVM, WASM and JS. The target-profile closure verifier is not yet a source compiler or signature verifier.

## AttoLang parity checkpoint (2026-11-21)

The canonical `atto.core/numeric` import aliases are accepted by the constrained JS static core linker, aligned with LLVM's compiler-owned numeric module candidate. Source-only aliases never grant `atto.alloc`, `atto.std` or `atto.runtime.actor` capabilities. New positive tests require the same checked-i64 ESM output as legacy aliases; negative tests reject shadowing, traversal, unknown canonical modules, and upward-tier import attempts. Source-organization Actions and real Node/browser runs are **NOT_EXECUTED** at this checkpoint; this change does not establish general `.atto` frontend support, allocator support or freestanding no-GC.
