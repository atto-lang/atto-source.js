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

## Body await and single recovery callback extension

The same explicit profile also accepts `return await input;` and one
`recover |err, cursor| -> { return await fallback; };` registration.
Binders are reserved lexical names (not yet usable in expressions). Each
Future parameter has exactly one lexical use; recovery-only input is not
subscribed on a normal exit. The body uses the existing scheduler driver
and physical lease; a failed body Future enters recoverable raise rather
than cleanup panic, LIFO cleanup precedes recovery, cancellation bypasses
recovery, and a failed recovery Future becomes panic. This is not general
body expression/control-flow lowering or unrestricted recovery semantics.
