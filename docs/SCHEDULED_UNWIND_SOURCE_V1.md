# Explicit scheduled-unwind-v1 source profile

This opt-in compiler API accepts one public suspension-marked function `run`,
one to eight distinct `Future<int>` parameters, exactly one braceless
`defer await` for each parameter, and a signed i64 literal return.
All four suspension aliases share the production lexer. The compiler emits a
static ESM `start(runtime,loop,ownerKey,identity,futures,onDone)` function.
The trusted embedder supplies the backend's scheduled-unwind-runtime module,
a live owner-bound control loop and real SelectableI64Future instances.
There is no Promise continuation, runtime source evaluation, guest identifier
interpolation or implicit blocking. A ready Future still schedules the next
quantum; a pending Future parks until its authenticated host subscription
commits. Result publication occurs only after LIFO cleanup. Failed cleanup
is panic; cancelled Future is cancellation; older defers still run.

This is deliberately NOT the general program-v2 frontend, general ordinary
await, recover lowering, Future constructors, dynamic calls, actor mailboxes,
arbitrary user-defined callbacks, or a production isolation boundary.
The supplied owner/identity/runtime remain trusted host authority. Fatal
scheduler failure and STOP deadlines still need explicit lifecycle handling.
The bounded source fixture is not a substitute for the shared conformance
corpus, nor evidence for other compiler backends.
