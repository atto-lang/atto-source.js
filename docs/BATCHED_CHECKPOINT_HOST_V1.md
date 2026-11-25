# Batched checkpoint host reference (not guest preemption)

`BatchedCheckpoint` is an opt-in host reference for a **compiler-proven bounded**
work unit. It calls the trusted synchronous slow-path poll only every 64/128/256/512
units, with 128 by default, or earlier at a final hard-fuel boundary. Pending
charges count against the remaining quota immediately; no cooperate/await API
can replenish the logical budget. A poll that throws or recursively reenters
makes the checkpoint terminal.

**Important:** JavaScript program-v2 currently does not lower general loops
or untrusted actors. This helper does not instrument arbitrary JavaScript
handlers, recursive calls, native addons, or WebAssembly. A trusted caller
cannot use it as a sandbox or a preemption proof. Compiler integration must
insert the fast-path counter into verified CFG backedges and call the slow path
only at the threshold; unsafe source is rejected until that lowering exists.

`rt cooperate` is not implied by a poll. Yielding requires a heap-saved,
ownership-proven continuation outside all critical/no-yield scopes. Host/FFI
boundaries must be separately admitted, bounded, or interrupted by isolation.
