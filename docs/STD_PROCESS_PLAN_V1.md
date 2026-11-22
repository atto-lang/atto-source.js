# std.process — JS compiler, Node/browser runtimes

This backend owns `stdlib/process_policy.atto` and its own import-based
`tests/fixtures/std-process-policy-v1/main.atto` expected-exit-42 fixture.
They contain pure guest admission checks only. Their success never grants
process creation, permission to execute a shell, or a real OS handle.

The public target is an async `process.spawn(Command)` returning an owned
`Result<ChildProcess,ProcessError>`, `wait()`, `terminate()`, `kill()`,
stdin/stdout/stderr bounded streams and a bounded `run()` convenience API.
The host must authenticate RUN, perform canonical command and environment
admission at the actual spawn boundary, and preserve actor-local permission
attenuation. Return denial, spawn failure, timeout and ordinary exit as
**distinct** outcomes. Avoid PID reuse and leaking raw host process objects.

## JavaScript backend provider (not implemented)
Node-only extension: use `node:child_process.spawn` with `shell: false` and an argument **array**, never interpolate a command string. Do not confuse Node `child_process.fork()` (launching a new Node interpreter) with POSIX `fork()`. Never inherit the whole environment, cwd, or handles implicitly: require separately authorized inputs. Treat event emissions for `error`, `exit` and `close` as a single terminal settlement, keeping the owned generation ticket and bounded streaming pipes until physical retirement. Handle cancellation, queue budgets, timeouts, escalation and stdout/stderr backpressure without actor-thread blocking.

**Browser target:** `process.spawn` is unsupported. Neither Web Workers nor `Worker` construction are OS process creation. Guest authorization must never be synthesized from an arbitrary JS object or options bag.

## Verification status

The `.atto` policy and fixture are source-only. The backend has not proven
parse/typecheck, linked import, real guest execution, AOT, an OS spawn,
stream/cancellation lifecycle or exact-head CI for this change. Mark each as
**NOT EXECUTED / NOT VERIFIED**, not as full `std.process` parity.
