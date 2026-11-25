# JS transpiler and Wasm/Worker tenant boundary

**Current scope (2026-11-08):** `oreslang-source.js` is a JavaScript/ESM transpiler. It emits **JavaScript, not WebAssembly**. The current source subset is not full AttoLang source actor lowering.

- `src/actor-host.browser.mjs` uses browser module Web Workers; `src/actor-host.node.mjs` uses Node `worker_threads`. These are **trusted-host serial Worker references** for handlers or compiled scalar functions, generally one Worker per host actor, not a verified tenant Worker with multiple compiler-generated actor instances.
- Source `define actor` lifecycle, compiler-owned heaps/stacks, ownership/borrow, suspension, mailbox/supervision and complete typed message lowering are not implemented in the JS transpiler.
- JS has a GC-managed heap; `Worker` does not mean zero-GC or OS-level untrusted tenant isolation. `trusted-worker` must not be misrepresented as `wasmtime-store`, a process sandbox, or a proven isolate.
- `oreslang-source.wasm` emits Wasm through a **native LLVM compiler + Clang/LLD** and separately prototypes native Rust Wasmtime. `oreslang-source.rs` instead emits native Cranelift objects and does **not** embed Wasmtime. The current `/play/` Rust compiler comes from **`atto-lang/atto-source.rs`**, not either of those repositories.

## Target architecture (not implemented by this JS transpiler)

```
Browser UI -> Rust compiler-as-Wasm Worker -> Atto guest Wasm32
           -> tenant A module Web Worker (trusted JS host scheduler/broker)
                  -> actor 1 WebAssembly.Instance + private Memory
                  -> actor 2 WebAssembly.Instance + different private Memory
           -> tenant B module Web Worker -> independent actor instances
```

JS should own the minimal host-only primitives: Worker lifecycle, exact import allowlists, bounded FIFO mailboxes, versioned **Sendable data-only** transport, generation-fenced ActorRefs, cancellation and capability/quota admission. The compiler and `.atto` library must own guest-visible actor semantics, heap/stack/continuation layout, and no implicit function/closure transport. Emitting JS handlers is **not** proof of execution in a Wasm instance.

**Memory isolation requires separate Wasm instances/memories for mutually isolated actors.** Two arenas inside one instance share one address space; Wasm instructions may address any accessible byte of that instance. A Wasm32 memory uses 32-bit offsets even on an ARM64/x64 host. Neither Wasmtime nor a native OS sandbox executes inside an ordinary browser Worker. A synchronous infinite loop can monopolize that Worker until a parent terminates it, losing all colocated actors.

The experimental browser-host reference and real Chromium fixture live at `oreslang-source.wasm/src/browser-tenant-worker.mjs` and `tests/browser-tenant-worker.browser.mjs`. They are **trusted, synthetic-guest evidence only**, not an approved production actor scheduler or compiler-backed `.atto` test. Require exact-head browser and Atto-compiled source tests, worker timeout/termination receipts, nonzero CI steps and independent security review before promoting actor capability.