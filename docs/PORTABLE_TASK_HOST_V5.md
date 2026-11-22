# Portable v5 externally pending signed-i64 guest future host

This is an experimental **full guest AOT** host profile for the Rust v5
compiler's `atto.browser.guest.v5` artifact. It does not interpret source,
use JSPI, manufacture guest functions dynamically, or treat a cooperative
yield as an external future completion.

`createPortableTaskHostV5({module,loop})` validates the exact version 5
guest module marker and eight lifecycle exports, ensures memory/table are
private and no unexpected imports exist, then creates a single Wasm
instance with 16 bounded private task frames.

`host.spawn({owner,ownerId,epoch,onPending,port})` creates an
independent task and a dedicated one-pending-at-a-time 128-bit-CSPRNG bearer
issuer using `worker-completion-capability-v1`. Each guest `await`
holds a signed i64 **external future key**, compiled as a literal or
initialized local. On registration, the host calls
`onPending({owner,ownerId,epoch,key,grant})` so the caller can send
`grant` to a trusted completion Worker. Supply a dedicated MessagePort
to `port`; the matching Worker port may respond with the exact structured
frame `{...grant,value:42n}`. The `value` must be a valid signed i64.

The host cannot schedule a DATA resume while the task is pending:
- `task_start_v5` creates an actual guest Wasm frame and yields its key.
- The authenticated MessagePort handler **only queues** a completion.
- The first later scheduler turn invokes `task_complete_v5` with the
  matching frame handle, owner, epoch and key, storing the Worker value.
- A **separate** subsequent scheduler turn invokes `task_resume_v5`
  and either settles the result or issues a new one-time ticket for the
  next pending guest future.
- On DONE, the host physically drops the guest frame before resolving the
  JavaScript Promise.

The cryptographic token authenticates *ticket possession*, not Worker
identity or integrity. A compromised recipient can choose the i64 result
of its authorized ticket. The caller must use a trusted dedicated port
and isolate untrusted code in its own Worker. The module marker is not
a cryptographic signature. Owner/epoch and Wasm frame generation checks
are additional, non-secret lifetime/authority fences.

Cancel immediately revokes the current bearer, then prioritizes CONTROL
destruction and frame erasure. A full CONTROL queue or closed scheduler
falls back to synchronous **destruction only** (never executing a guest
continuation). `host.close()` revokes and drops all active frames even
after the scheduler closes. Completion replays, wrong owner/epoch, malformed
structured clones and out-of-range signed-i64 payloads are rejected by the
reused ticket verifier.

This is intentionally **not** a general `Future<T>` implementation:
source-level `Future<int>` constructors, typed result errors, arbitrary
CFG/borrow spilling, multiple guest functions, task trees, supervisor
policy and async mutexes are future work. The v5 source compiler currently
maps `await int_key` to an external keyed i64 future only in opt-in v5
mode. Preserve v3 and v4 for their existing source semantics.

Tests: `node --test tests/portable-task-host-v5.test.mjs` uses
versioned Wasm ABI fixtures, real Node Worker/MessagePort communication,
16 held pending frames, cancellation races, one-shot replay denial and
shutdown cleanup. The Rust PR's real compiler-generated guest tests in
Node and Chromium must also pass before claiming cross-backend AOT parity.
Both PRs remain Draft.
