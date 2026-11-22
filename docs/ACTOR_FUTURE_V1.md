# ActorFuture<int> v1 — actor-incarnation-scoped single replies (full AOT)

`ActorFuture<T>` represents **one terminal actor response** with actor
provenance and a request correlation key. It is not interchangeable with a
generic `Future<T>` (which may represent timer/I/O/computation completion)
and is **not a stream**. Long-lived/multi-event actor exchanges need a
separately versioned `ActorStream<T>` with demand/backpressure,
per-message ownership, cancellation, and a defined terminal event. Do not
silently consume a stream as a future.

## First executable profile

Only `ActorFuture<int>` with a signed-64-bit reply, statically bound
actor ID, static request key, 1–8 straight-line awaits, and 16 live Wasm
frames in one instance. Source in `atto-source.rs`:

```atto
pub susp fnc main(): int {
  val reply: ActorFuture<int> = actor_future_int(7, 41);
  return await reply;
}
```

The compiler emits the existing, verified full-AOT guest-v5 lifecycle and
a separate `atto.browser.source.actor_future.v1` marker containing
`version=1,count,[(actor_id:u32,key:i64)]` in **await order**.
The source constructor is not a general runtime callable. Actor IDs are
positive compile-time i32 constants; keys are nonnegative compile-time i64
constants. The trusted host, *not source code*, supplies the current
actor incarnation. This is an independently enabled compiler target, not a
change to the v3/v4/v5 or generic Future implementations.

## Host protocol

`createActorFutureHostV1({module,loop,onSupervisorNotice,makeChannel})`
requires a valid guest-v5 module, versioned actor manifest, and a single
producer actor ID in the first profile. No Wasm linear memory or table
is exported. The caller must admit only trusted compiled code: the
marker is not an executable signature.

`registerActor({actorId,incarnation,controlPort})` binds a trusted host
actor registration; incarnations are positive monotonically increasing i32s.
The actor's `controlPort` is a trusted, dedicated connection to its
Worker. Multiple owner tasks may share that actor but each receives its
**own reply MessagePort**. The host sends the actor:

```js
{
  type: 'atto.actor.future.request.v1',
  actorId: 7, incarnation: 1,
  requestIndex: 0, key: 41n,
  owner: 'scope-1', epoch: 1,
  grant: {type, owner, epoch, ticket, capability},
  port: replyPort // ONLY on first request for this owner, transferred
}
```

The actor Worker replies *on the per-task port* with
`{...grant,value:42n}` (the inherited v1 strict six-field completion
frame). The 128-bit CSPRNG grant proves possession of **this** reply
ticket, not the identity of an arbitrary network peer. Its binding to a
trusted actor Worker control channel is what establishes actor provenance.
An untrusted or compromised actor Worker can choose its authorized
reply value; keep it isolated. The host validates actor ID, active
incarnation, awaited key, and exact request ordinal and **only queues**
completion. Guest `task_complete_v5` and `task_resume_v5` execute on
separate synchronous scheduler turns. No premature polling, interpreter,
JSPI, or guest runtime code generation.

`stopActor({actorId,incarnation,kind,reason})` is a trusted host action
(never triggered by untrusted reply messages), and first fences new
admission, then revokes all outstanding futures for that incarnation.
The host sends `onSupervisorNotice({actorId,incarnation,kind,reason})`
for `panic`, `raise`, or `terminated` after revocation, never routes
panic to the faulting actor. Awaiting tasks reject with a typed
`ActorFutureFailure` whose `code` identifies the failure kind.
A restarted actor **must** register a strictly larger incarnation; old
reply tickets, ports and task handles cannot authorize its work.
`host.close()` revokes all active actor futures and cleans guest frames.

This uses the existing v5 CONTROL queue for cancellation; supervisor
notice transport into an entire actor tree and restart-policy decisions
are still owned by the wider Atto Director runtime. Actors may
participate in multiple groups; ActorFuture binds the **producer actor
incarnation** independently of group membership.

## Explicit limitations

This is an executable bounded **actor-response profile**, not full actor
mailbox/send admission, true `ActorRef<T>` typed constructor validation,
multiple producer actors in one guest task, generic `ActorFuture<T>`
specializations, typed `Result<T,E>` failure as a guest value, arbitrary
CFG continuation spilling, streaming actor responses, or full actor
supervision integration. A single response is delivered at most once;
second/streamed replies are denied as replays. The current compiler does
not issue a real actor `send` command; the host routes the source request
key through the registered Worker transport.

Required proof: host-only JS tests (including a real Node Worker),
the Rust compiler's actual guest-Wasm Node test with 16 tasks, 32
correlated requests and replies, incarnation fencing and failure
notices, plus wasm32 Rust compiler execution in a real Chromium Worker.
Keep both PRs Draft; no playground promotion from this subset alone.
