# Authenticated Worker completion admission v1 (experimental, host-only)

This is a **capability-authenticated scalar completion boundary** over a dedicated,
trusted MessagePort. It does not yet supply compiled AttoLang `Future<T>`
semantics, task frame arenas, or a general guest ABI. It can be used beside
the portable v3 one-task-per-Wasm-instance scheduler without invoking JSPI.

## Producer/consumer contract

The owning Worker host constructs `createWorkerCompletionCapabilitiesV1` with
a trusted `createWorkerControlLoop`, a fixed `owner`, `epoch` and
`maxPending` quota. This attaches one owner. Each `reserve(resume)` obtains
one private scheduler suspension ticket and issues a CSPRNG-generated 128-bit
single-use bearer capability:

```js
{
  type: 'atto.continuation.complete.v1',
  owner: 'task-42',
  epoch: 7,
  ticket: 1,
  capability: '<32 lowercase hex characters>'
}
```

The trusted producer receives this grant over an explicit restricted port. It
responds with an otherwise exact copy plus one signed-64-bit `bigint` field
`value`. The receiver rejects mismatched owner, epoch, ticket, token, kind,
object shape, replay, stale generation, non-bigint payload, out-of-range signed
i64 payload and accessor-bearing property descriptors. No arbitrary JS object
graph, functions, user callbacks, memory or raw Wasm pointers cross the wire.

`complete(frame)` calls only `loop.complete(privateTicket, value)`, which
enqueues a later synchronous scheduler quantum; the MessagePort event handler
never invokes the resumed guest code. Once admitted, a ticket is consumed even
if a duplicate arrives in the same JavaScript tick. `cancel(grant)` requires
identity of the original host grant object; `close()` cancels all pending
tickets, detaches the port handler and retires the owner. The owner epoch must
advance before it is reused.

## Security boundary

- A random bearer capability demonstrates possession, **not the peer's
  identity**. A compromised Worker that receives its grant can complete that
  grant once with a chosen signed-i64 value. Do not give it another tenant's
  grant. This is not a signature, an encrypted channel, or protection against
  a compromised trusted host.
- Capabilities must be sent only to the intended producer on a dedicated
  MessagePort, not broadcast or logged. Browser/Node structured cloning
  prevents JS accessor objects traversing the port, and the receiver also
  rejects accessors on direct `complete` calls.
- No promise/JSPI execution occurs in the scheduler lane. Existing global
  guest trust, host cancellation obligations, and non-preemptible synchronous
  Wasm execution restrictions remain unchanged.
- The v1 wire representation is intentionally **only i64 completion data**.
  Future<Result<Option<int>, IoError>>, error/cancel outcomes, generic
  `Future<T>`, per-task memory frames, supervisor authentication, and
  compiled Rust guest resume integration require a later version and specific
  conformance tests before promotion.

Run `node --test tests/worker-completion-capability-v1.test.mjs` for Node
MessagePort/replay/epoch/quota tests. This tests real inter-Worker messages but
is a host-only integration check, not compiled guest execution.
