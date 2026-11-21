# Experimental JS Worker control loop (host-only v1)

**Status:** review candidate. This is not a source-compiled `susp`/ `suspends` or `await` implementation, not an actual NIO/TCP reactor, and not an untrusted TenantVM sandbox. The public playground compiler is unchanged.

## Shared architecture

```text
Atto Task / susp callback / actor  [future compiler source lowering]
                  |
 OresVM / TenantVM (owner, epoch, capabilities, lifecycle)
                  |
 OresScheduler (bounded CONTROL and ready queues, one synchronous quantum)
                  ^
 NIO/reactor adapter (I/O readiness, timers, worker messages; no guest code)
                  |
 Browser: Web Worker + browser event loop
 Node.js: worker_threads + Node event loop / V8 execution environment
 Native: Java selector / LLVM epoll / kqueue / IOCP where supported
```

The portable contract is **logical continuation scheduling**, not an imposed OS thread count. A Web Worker is a separate browser Worker global, not a direct V8 isolate-management API and not a security boundary for hostile same-origin JavaScript. A Node `worker_threads` Worker is a separate JS execution thread. Neither automatically provides CPU affinity or the OresVM/TenantVM authority boundary.

## Implemented in `src/worker-control-loop.mjs`

- `attachOwner(owner, epoch)` registers one lifecycle generation.
- `beginSuspension(owner, epoch, resume)` reserves a bounded, opaque **host-local** ticket.
- Reactor/I/O completion calls `complete(ticket, value)`; that call only enqueues a future continuation and never invokes it inline.
- `admitData` and `admitControl` enqueue synchronous continuation quanta. CONTROL has an independent reserved queue with priority over DATA, each dispatch executes at most one quantum, and the default `postTurn` yields to the JS host event loop.
- `cancel(ticket)`, `retireOwner(owner, epoch)` and `close()` fence stale completions and queued work. Reusing an owner requires a strictly larger epoch. To avoid unbounded tombstone memory, the host loop caps its lifetime owner-identity history at 65,536 identities and rejects additional identities when that ceiling is reached.
- Capacities for owners, suspended tickets, ready work, and CONTROL are separate and bounded. A full ready queue retains the waiting ticket so callers can retry completion instead of silently discarding it.
- A Promise-returning quantum is rejected and observed, not awaited while claiming the scheduler lane; compiler lowering must split at suspension points.

`postTurn` is a **trusted asynchronous host scheduler hook**; a synchronously invoked callback triggers terminal fail-closed shutdown rather than executing guest code inside admission. Callers must never inject a synchronous callback executor or expose host continuations to arbitrary tenant code. The ticket is checked by object identity, **not serializable authority**: wire protocols crossing Worker ports must validate their own owner, epoch, ticket, capability and limits before dispatching to this module. There is no implicit guest import or network permission.

## Still needed before the requested mutex example runs

1. Reconcile Rust/Wasm `susp`/ `suspends` parser, typed effect checking, general first-class susp callbacks, lazy Task/Future and JSPI/source-continuation ABI; keep unsupported forms fail-closed.
2. Make `new Mutex<int>(0)` a compiler-owned identity-bearing resource. `using counter.lock_async() as lock_lease` is typed contextual `await` **before** the lease. Permit `using await` explicitly. After admission, forbid await/select/unknown may-suspend calls **inside** the active guard.
3. Connect the bounded, generation-fenced mutex wait/grant/cancel queue to OresVM/TaskScope, schedule ready continuations through OresScheduler, and guarantee guard cleanup on exit, throw/raise, cancellation and shutdown.
4. Give browser and Node JS adapters a tested message-port/worker transport with authenticated ticket ownership, cancellation, stale completions and actual guest continuation frames. Use host event loops as the NIO equivalent where raw sockets and selector threads are unavailable; reject unsupported socket operations.
5. Execute real source-compiled Wasm guest positive/negative fixtures, Chromium and Node worker runs, and exact-head CI before changing `atto-lang.github.io/play` labels or the pinned compiler. The expected mutex example prints `1`, returns `0`; bare `Mutex<int>(0)` is rejected under the canonical resource-constructor rule.

## Overlap and evidence boundaries

- [atto-source.rs #416](https://github.com/atto-lang/atto-source.rs/pull/416) covers *uncontended* source-compiled `Mutex<int>` fast-path and a host-only TaskScope coordinator, not general contended guest scheduling.
- [atto-source.rs #186](https://github.com/atto-lang/atto-source.rs/pull/186), [#189](https://github.com/atto-lang/atto-source.rs/pull/189) and [#197](https://github.com/atto-lang/atto-source.rs/pull/197) cover incremental JSPI/async and `susp` parsing.
- [atto-spec #125](https://github.com/atto-lang/atto-spec/pull/125) defines target mutex/lease effects; [atto-source.js #43](https://github.com/atto-lang/atto-source.js/pull/43) reserves resource construction but intentionally rejects runtime mutex.
- Existing JS Worker endpoint/host adapters retain their current serial handlers and mailbox protections; this isolated scheduler module does not rewrite those lanes or claim integration with compiled Atto guests.
- Java OresScheduler, OresVM/NIO and LLVM native reactor prototypes remain separately owned. Do not replace them with JS threads or count host-only queue tests as compiler/runtime parity.

Focused host tests: `node --test tests/worker-control-loop.test.mjs tests/worker-control-loop-node.test.mjs`. The second suite executes a genuine Node `worker_threads` Worker. `npm run test:browser` now also runs `scripts/browser-worker-control-loop-smoke.mjs`, which creates an actual Chromium module Worker. As of this draft, the local Node 22.16.0 tests pass **10/10** with source/test blob identity verified; the new Chromium harness has **not executed its page successfully** because the local browser denied localhost navigation (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). The full backend suite, exact-head Actions tests, Wasm guest and compiler source tests remain **NOT EXECUTED**. Do not report browser or compiler parity.
