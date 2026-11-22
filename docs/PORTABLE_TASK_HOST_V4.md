# Portable task host v4 — one Wasm instance, bounded multi-frame arena

`src/portable-task-host-v4.mjs` is a reusable JavaScript scheduler adapter
for the **opt-in full-AOT guest v4** produced by Rust compiler
`compile_portable_v4(source)` / `attoc --portable-v4`. It does not compile
source, interpret a guest continuation, call `main`, use JSPI, or create a
guest Wasm stack in a Promise. All six lifecycle exports are ordinary
synchronous Wasm functions.

## Admission, ownership and API

`verifyPortableTaskGuestV4(WebAssembly.Module)` requires exactly one
`atto.browser.guest.v4` custom marker payload `04` and `atto.async`
payload `02`; no v3 marker; only the legacy `atto.cooperate` compatibility
import; six named lifecycle function exports; and no exposed memory, table or
`task_invoke`. Markers are **not signatures**: callers must still admit only
trusted compiled artifacts and isolate untrusted guests in their own Workers.

`createPortableTaskArenaHostV4({module,loop})` constructs one Wasm instance
with an unreachable `atto.cooperate` stub and a bounded 16-task arena. It
accepts a trusted `createWorkerControlLoop()` or owns a default instance.
`host.spawn({owner,ownerId,epoch})` returns a frozen task controller with
`result:Promise<bigint>`, `cancel()`, and `stats`. It validates owner
names, signed positive 32-bit IDs and epochs and admits exactly one scheduler
turn to start the task. A later DATA turn resumes; DONE reads the i64 result
then physically drops the corresponding frame before resolving the Promise.

`cancel()` queues CONTROL-priority cancellation. A queued DATA turn also
checks cancellation before attempting a guest resume. The owning runtime
must explicitly invoke `host.close()` on shutdown, even after its external
scheduler was already closed, to cancel and drop every active guest frame.
This performs bounded scalar frame operations synchronously; it never runs
the source-level entrypoint on emergency shutdown. The adapter tracks
`started`, `turns`, `resumes`, `cleanups`, and `peak` physical
concurrently allocated Wasm frames (distinct from outstanding host promises).
Owner/generation safety is checked again within every guest lifecycle export.

## Boundaries

- One Wasm instance can hold 16 independent v4 task frames and no more.
- The guest stores frames in non-exported, fixed Wasm linear memory.
- The task arena generation counter never wraps and is not reset on drop.
- Only the v3-checked straight-line scalar/initialized-`int` task source
  subset is v4-lowerable. Every await here is an unconditional cooperative
  yield, **not** yet a truly pending `Future<T>`.
- Arbitrary callback functions, typed Future completion, cross-Worker bearer
  wakeups, actor ownership/supervision, general CFG spilling, and contended
  `Mutex<T>.lock_async()` remain unimplemented.
- A malicious synchronous Wasm guest cannot be preempted by JavaScript.
  The module verifier is an ABI gate, not a secure executable signature.

Tests: `node --test tests/portable-task-host-v4.test.mjs` exercises
host-only lifecycle scheduling, cancellation, shutdown and marker validation.
The Rust compiler repository's `tests/portable-v4-e2e.mjs` and Chromium
browser test execute *actual compiler-generated guest Wasm* and are required
for end-to-end claims. Keep both source PRs Draft.
