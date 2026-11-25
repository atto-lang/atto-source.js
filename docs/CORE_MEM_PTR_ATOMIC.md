# JS compiler independently owned `.atto` core memory policies

These `stdlib/core/{mem,ptr,atomic}.atto` sources are backend-owned Atto
algorithms, not JavaScript runtime shims. `mem` checks alignment,
stride/size overflow and bounded spans; `ptr` checks indexed region
offset arithmetic (not a pointer capability); `atomic` checks legal
memory order and CAS failure orders, with seq_cst as default.

The module is freestanding; no OS/JS host, runtime heap or actor
authority. **No real Atomic<T>, shared memory, CAS, RMW, fences,
dereference, provenance, generational lifetime, or destructor is enabled
by this source.** Invalid size predicates fail closed, and order
validation cannot authorize operations whose guest compiler is missing.

`tests/core-memory-policy-source.test.mjs` is a restricted 63-vector
Atto source-subset test, explicitly **NOT** compiled JavaScript output
from the Atto compiler or AOT/worker execution. Real guest imports,
positive/negative compiler tests and tenant isolation proof are needed
before claiming support. Keep the PR Draft.

Related work: Java #1771, LLVM #873/#801, Rust #537/#419,
atomic spec #175, pointer specs #18/#154 (conflicting targets).
