# atto-source.js

JavaScript compilation backend and runtime compatibility layer for AttoLang.

## Scope

This repository is the AttoLang ecosystem home for:

- JavaScript lowering, host interoperability, and web-compatible actor semantics.
- Compatibility with the [canonical language specification](https://github.com/atto-lang/atto-spec) where applicable.
- Evidence-based tests, benchmark results, and cross-backend conformance reporting.

## Architecture and compatibility

AttoLang is designed around actors, explicit ownership, and portable concurrency semantics. Backend-specific optimizations must not silently change the shared language contract. Runtime capabilities, target restrictions, and unsupported features should be documented explicitly.

## Building and testing

Consult the checked-in source tree and CI workflows for verified commands and supported targets. Add target-specific build instructions and exact-head execution results as they become available; do not treat a passing host-unit test as proof of guest-language conformance.

## Project status

This README describes the repository's intended responsibilities. Feature support and release readiness must be established from implementation, tests, and CI evidence rather than this description alone.

## Related repositories

- [AttoLang organization](https://github.com/atto-lang)
- [Language specification](https://github.com/atto-lang/atto-spec)
- [Platform conformance](https://github.com/atto-lang/atto-platform-conformance)
- [Commercial infrastructure](https://github.com/atto-co)

## Repository ownership and contribution routing

**Belongs in this repository:** AttoLang-to-JavaScript lowering, JS runtime/interop boundaries and browser/Node worker scheduling adapters with capability-scoped messaging.

**Belongs elsewhere:** Rust-to-Wasm compiler internals (atto-source.rs), Wasm backend ABI (atto-source.wasm), or static playground deployment (atto-playground).

**Safety and verification boundary:** Web Workers and Node worker_threads are hosts, not hardware tenant sandboxes; reject unsupported semantics, bound workers/mailboxes/output, and keep guest data separate from host capabilities.

Keep canonical AttoLang (.atto) semantics consistent with the language specification, while treating Oreslang-named tooling and .ores as compatibility surfaces.

Changes asserting compiler/runtime support must identify the exact source head, target, toolchain, executed positive and negative guest tests, and failure/unsupported status; an empty CI step list is **not executed**. Documentation records responsibility, **not** a claim of feature completion.
