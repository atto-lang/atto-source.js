> **AI agent instructions (organization-wide):** Before working on code, issues, or pull requests, read and follow the [organization `AGENTS.md`](https://github.com/atto-lang/.github/blob/main/AGENTS.md), including its **merge-first stealth-development policy**. Honor any repository-local `AGENTS.md`, explicit holds, and GitHub-enforced rules.

# atto-source.js

JavaScript compilation backend and runtime compatibility layer for AttoLang.

## Naming and specification migration

This is the canonical [AttoLang backend repository](https://github.com/atto-lang/atto-source.js). Use `.atto` for portable AttoLang source and update local remotes to `https://github.com/atto-lang/atto-source.js.git`; do not use historical repository links or naming in new examples.

- **Normative grammar and semantics:** [atto-spec](https://github.com/atto-lang/atto-spec). Check the current versioned contracts for ownership operations (`borrow!`, `take!`, `share!`, `copy!`, `copy!!`), implicit argument borrowing, `lt!` binders, `eq`/`neq` value equality, `susp` effects and file/module `define const`. These are *specification targets*, not claims of executable support in this backend.
- **Positive and negative guest execution evidence:** [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance) and [atto-compilers-parity-testing](https://github.com/atto-lang/atto-compilers-parity-testing). Report `passed`, `failed`, `unsupported` or `not executed`, and pin exact compiler, source tree, target and toolchain.
- **Portable shared sources and target constraints:** [atto-common-source](https://github.com/atto-lang/atto-common-source) and [atto-target-profiles](https://github.com/atto-lang/atto-target-profiles). Keep backend-specific gaps explicit, and do not infer guest parity from host tests or zero-step CI runs.

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

Keep canonical AttoLang (`.atto`) semantics consistent with the language specification; migration-era interfaces are not evidence of current portable support.

Changes asserting compiler/runtime support must identify the exact source head, target, toolchain, executed positive and negative guest tests, and failure/unsupported status; an empty CI step list is **not executed**. Documentation records responsibility, **not** a claim of feature completion.


## Experimental checked-i64 browser-worker subset

`src/transpile-worker.mjs` exposes `transpile_to_worker(source)`. Its emitted
ES module exports `create_tenant({tenant,generation})` with a one-shot
`on_message()` handler. The *supported* scalar profile accepts only a single
`main(): int` returning a signed-i64 expression (unary minus, parentheses,
addition, subtraction and multiplication). Checked BigInt overflow traps.

An additional, tightly restricted actor profile accepts **one**
`define actor` with one signed-i64 additive `ActorMail<int>` receiver,
an actor-local integer field, `stdio.println`, and `main` spawning that actor.
It exposes `on_route` to a **trusted** JS Worker host. All other actor
features and unsupported syntax must be rejected, not silently compiled.
See `tests/transpile-worker.test.mjs` and `tests/actor-worker.test.mjs`.

These are experimental host-execution subsets; **not** the full Atto language,
general actor lowering, source ownership/borrow analysis, or a substitute for
Rust/Wasm compiled guest conformance. Web/Node Workers do **not** securely
sandbox arbitrary JavaScript within the same origin. Do not run untrusted
tenants through this JS backend. Use `npm test` with Node 22+ for its focused
host tests, and report separate browser/compiler/guest validation evidence.


## Narrow inline `sync task` preview (trusted JS only)

The checked-i64 browser-worker subset admits pure, nonsuspending
`sync task<int> { return expression; }` and inferred
`sync task { return expression; }` expressions, including nesting.
Empty `sync task {}` has a `void` result and must use
`do sync task {};` when its value is discarded. The **only** permitted
payload for `do sync task` is `void`: the explicit
`do sync task<void> { return; };` and inferred-void
`do sync task { return; };` are accepted, but `do sync task<int>`
or `do sync task { return 42; }` reject with `E_TASK_RETURN_TYPE`.
A bare `sync task {}` statement is rejected with
`E_TASK_DISCARD_REQUIRES_DO`. To produce a value, consume
`sync task<int> { return expression; }` as an expression instead. Every supported inline body executes immediately on the caller's
logical execution path, without a child Future, TaskId, worker dispatch,
or new cancellation target. Checked-i64 panics in discarded expressions
are still observed. There is no host-JavaScript passthrough.

This is **not** a general Task implementation. Task spawning, `await task`,
suspension inside inline bodies, captures, `using`/`defer`, locks,
cancellation safepoints and arbitrary side effects remain unsupported and
fail closed before generating a guest module. Web Workers are not a secure
TenantVM. See `tests/sync-task-inline.test.mjs` and the normative target in
atto-spec #129; host tests alone do not certify cross-backend conformance.

The inline-task scanner checks the significant decimal digits against the
signed-i64 bounds **before** invoking BigInt, including negative-minimum
literals with long leading-zero padding. Source bytes, token count, expression
nesting, and task count are bounded. This admission check does not implement
cancellation or make JavaScript Workers into a secure TenantVM.
