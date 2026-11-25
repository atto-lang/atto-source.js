# Java-first Atto JS reconciliation — 2026-11-25

Temporary implementation reference: atto-source.java current main and newest reconciled strict Atto contracts, not old Oreslang compatibility drafts. Java host-specific representations do not define guest semantics.

1. Java #72/#70 define statement-only ^, contiguous signed-i64 ^^, integer & > ^^ > |, and reject infix ^, Boolean XOR and raw %. Checked program-v2 and its Atto scalar entrypoint implement these here. Legacy wrapping scalar-v1 is not canonical. JS #91's removed-XOR fixture is superseded; #46's shift/worker lowering still requires integration. Checked shift counts 0..63; typed << / >> are not numeric shifts.
2. Java #1704 governs trap / trap!: Result<T,Error>, preserve existing Result and nested Option, catch only ordinary typed throw. JS #73's bounded numeric implementation is retained, not general guest throw/raise/panic. Java #610 Option<void> tests must be ported, not restored.
3. Java #579's Future<Option<T>> is obsolete as a portable trap design: target Future<Result<T,Error>> (or preserved existing Result) with cancellation and panic exceptional; async syntax, cleanup and actor failure tests still required.
4. Java #1736 governs arithmetic overflow and divide-by-zero guest codes 65537/65538; this branch already has branded typed arithmetic errors. Host RangeError is an internal carrier only. Matching, serialization and cross-actor transport still require proof.
5. Java #1804/#1743: independent receives/sends/emits, mailbox admission not completion; JS #31/#42 remain restricted until typed stream, ownership and supervisor tests pass.
6. Java #1846: identical inline value/cooperation/local-loop/writeback fixtures; JS #68 must preserve caller frame/cleanup and avoid unnecessary Promise/child dispatch.
7. Java #1141/#664: anonymous struct/record parameters imply readonly structural loans; named types nominal unless explicit; writable fields invariant; no actor structural erasure. JS #77 remains incomplete source lowering.
8. Java #1216: explicit source export of nominal Symbol identity, no implicit host ESM exposure. JS #81 remains incomplete.

## Architecture constraint
Full ahead-of-time compilation means closed-world source/type/ownership checks, validated typed IR and statically emitted artifacts with no runtime eval, dynamic compiler or runtime import of guest source. Ordinary ESM/BigInt/Promise/WeakSet and V8/Node heap objects can allocate and be garbage-collected: deterministic source emission is NOT zero-GC or native AOT proof. Target an explicit bounded linear-memory/arena-backed guest ABI with actor-owned heaps and frames, statically typed move/borrow operations, deterministic drops, fixed-size scalar values and bounded error/continuation records. Keep GC-dependent host adapters outside the zero-GC guest claim. No browser-engine zero process GC claim. No fallback to a dynamic dialect or unbounded host allocation for unsupported features.

## Evidence
Authored Node regressions run source -> IR -> JSON IR -> emitted ESM. Isolated V8 preflight (ASCII TextEncoder adapter, module import/export adaptation): 8 positive, 8 negative cases passed. Exact-head Node, browser, native/closed-Wasm AOT, ownership and allocation/GC gates still required. Do not merge solely on isolated preflight. No external source transfer.
