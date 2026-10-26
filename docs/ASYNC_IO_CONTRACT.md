# Async-only guest I/O contract (JS backend)

This is a **normative design contract**, not a claim that existing JS host I/O is fully audited or conformant.

- All guest-visible filesystem, network, DNS, process streams, timers and IPC must return a Future/Promise or guest asynchronous stream. An I/O operation must not synchronously wait for kernel, remote peer, disk or worker completion on the guest execution lane.
- No `readFileSync`, `writeFileSync`, `execFileSync`, `spawnSync`, `Atomics.wait`, synchronous XMLHttpRequest or sync FFI is allowed in the guest runtime, standard library, or generated output. Prohibit disguised blocking adapters that call these APIs. Generated code must not use a sync fallback if an async facility is missing.
- `async` syntax alone does not prove nonblocking behavior: a Promise wrapping a synchronous operation is nonconformant. Host-side asynchronous APIs must use evented/nonblocking OS facilities or offload unavoidable blocking primitives to bounded dedicated workers. An offload worker must never be an actor execution carrier, and lifecycle barriers must wait for physical worker retirement.
- Expose **one async-default guest API**. Do not grow parallel `*_async` guest methods. If explicit blocking tools are ever provided, they must be tooling-only, outside core/std, and visibly labeled `*_blocking`/`*_sync`; never implicitly substitute them for the async API.
- Preserve backpressure and bounded buffers: writes must await capacity, reads must be cancellable, and streams must not turn unlimited concurrent requests into an unbounded queue.
- Cancellation must cover pre-acquisition, in-flight operations, disposal, terminal races and worker termination. Close/unref/abort must not mark actor `get_done()` before OS and worker resources retire.
- Guest isolation: host capabilities must be explicitly granted; browser workers must not acquire Node I/O privileges through generated imports, dynamic import or opaque host bridges.
- Distinguish **compiler build tooling** (which may use synchronous startup configuration reads) from the *guest core and standard library*. The async-only assertion applies to the latter, plus any runtime helpers reachable from guest code.

## Required evidence before parity claims

1. Static guard scans all guest-reachable JS modules and emitted source, including `node:fs`, `node:child_process`, `Atomics.wait`, sync XHR and `*Sync` aliases; adversarial fixtures prove aliases and computed-property evasion are caught by semantic rules or code review.
2. Native Node + browser worker behavioral tests: slow reader, full output pipe, socket backpressure, cancel-before-open, cancel-after-open, aborted read/write, error/EOF, closed worker and guest shutdown; assert scheduler heartbeat progresses during pending I/O.
3. Run `npm test` and worker/browser suites on an *exact* commit head; record checks that actually execute tests, not zero-step CI.
4. A shared cross-backend fixture must exhibit the same guest success/error, cancellation and EOF semantics on Java, LLVM, .NET, WASM and JS. Unsupported operations must reject at compile/admission time rather than silently block.

## Audit note

The CLI `bin/oreslang-jsc.mjs` uses `node:fs/promises` for file access and now awaits
stdout write completion so compiler-tooling output observes backpressure. Tooling output
remains separate from guest I/O.

`tests/async-io-contract.test.mjs` is an executable default-`npm test` gate over the
guest-reachable Node/browser runtime modules. It rejects synchronous filesystem and
child-process APIs, `Atomics.wait`, synchronous alternative-runtime filesystem APIs,
and XMLHttpRequest. It also compiles scalar-v1 and program-v2 fixtures and verifies that
emitted ESM acquires no Node/require host I/O surface. This is a fail-closed boundary
test, not functional stdlib I/O parity: the transpiler still has no general guest I/O
lowering, and unsupported I/O must remain unsupported rather than gaining a sync fallback.
