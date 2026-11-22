# Experimental JS Worker control loop (host-only v1)

**Status (2026-11-21):** review candidate. The underlying control loop is host-owned, and now has a limited source-compiled Rust/Wasm guest v3 AOT lifecycle integration; it is **not** general `Future<T>` compilation, a production NIO/TCP reactor, authenticated cross-Worker transport, or an untrusted TenantVM sandbox. The public playground compiler is unchanged.

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

## Experimental fully AOT guest-v3 continuation adapter

The exported `./portable-task-host-v3` module verifies the exact `atto.browser.guest.v3` marker (one byte, value 3), compatibility async/2 marker, one static `atto.cooperate` import, and the five required lifecycle function exports. For the **closed single-task scalar literal-await profile only**, it instantiates ordinary Wasm and deliberately makes the legacy `atto.cooperate` import throw. It never calls `WebAssembly.Suspending` or `WebAssembly.promising`.

It schedules one synchronous Wasm lifecycle call per DATA turn. The first `task_start_v3(owner_id,epoch)` returns `PENDING=1`. Subsequent `task_resume_v3` calls either return `PENDING=1` or `DONE=2`. The final result is read as i64 and `task_drop_v3` is called before resolving the host-side Promise. Cancellation marks the run as revoked immediately and requests a reserved CONTROL turn to call `task_cancel_v3` and `task_drop_v3`. A cancelled queued DATA turn must not resume the guest. Retirement and error cleanup are fail-closed and remain in the trusted owning Worker. If the scheduler has already been closed, its owner must explicitly call `host.cancel()` during shutdown; the adapter then runs only bounded compiler-generated cancel/drop destructors immediately and rejects the host Promise because there is no remaining CONTROL turn. Merely calling `loop.close()` without notifying the host does not automatically reject outstanding host Promises.

Guest status codes for the currently implemented slice: `READY=0`, `PENDING=1`, `DONE=2`, `CANCELLED=4`, `INVALID=-1`; `FAILED=3` is reserved only. Owner/epoch values are identity fences, **not authenticated serialized capabilities**. The v3 marker by itself is not a trustworthy code signature: the adapter must be used with verified source-compiled artifacts, not arbitrary untrusted Wasm. It does not yet implement actor-scoped arbitrary continuation frames, cross-Worker migration, general `Future<T>`, fairness for contended mutexes, or guard cleanup.

The companion Rust compiler PR #197 emitted the actual guest Wasm, and its private source-exact CI executed this exact host file in both Node and a genuine Chromium module Worker, without JSPI. Each await required a new scheduler quantum; completion dropped the Wasm global frame. Independent JavaScript backend CI also verified the adapter's marker fail-closed checks. These remain experimental Draft changes; no public playground promotion is authorized.

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
