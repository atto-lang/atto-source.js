# Checked indexed i64 compound update (experimental v1)

This change stacks on draft typed-IR PR #101, source-lowering PR #99 and
runtime PR #97. It **does not** promote the experimental compiler to the
ordinary scalar compiler, general HIR/MIR or shipping CLI.

Source forms admitted after nominal field and owner validation:

```oreslang
rows[h].id += 5;
rows[0].id += -2;
```

Only `i64` fields with checked signed-`i64` literal deltas are supported.
The source parser emits one `add_i64` typed IR statement containing owner
slot, field ordinal, validated dense position / same-owner handle and scalar
delta. The IR validator rejects forged owners, erased handles, non-`i64`
fields, malformed deltas, extra object properties and unsupported IR
discriminants.

The emitter calls a **single** owning-runtime primitive, `addI64` or
`addI64At`. It does not lower `+=` to a guest-visible `read` followed
by a separate `write`. Index/handle resolution occurs once, then the
runtime checks field type, signed delta, conflicting column loans, and
signed overflow *before* publishing the updated cell. On overflow, existing
field value and row handle remain unchanged. In a Worker each array has a
single owning execution domain; this is not an inter-Worker shared-memory
atomic instruction.

Tests extend `tests/worker-inverted-array.test.mjs` and
`tests/inverted-typed-ir-v1.test.mjs`. Cover: position and handle updates,
overflow without partial writes, underflow, wrong field/operand types,
read/write loan conflicts, stale and foreign handles, signed limits, and
forged direct-IR forms. Legacy source fixtures must remain unchanged.
All existing unsupported `f64 +=`, methods, source callbacks,
`await`/Task capture and loan escape cases still fail closed.

## Verification and release gates

Isolated V8 execution of **exact checked-in GitHub source/test blobs**:
10/10 host runtime tests passed; two targeted source updates produced 42,
two unsupported typed source forms rejected, and ten deliberately tampered
`add_i64` IR forms rejected. This is a **host V8 evaluation**, not a
Node 22 `node --test` run, Chrome Worker or complete compiler suite.

A rerun of JS PR #101 original Node 22 workflow
`40562349719` (attempt 2) concluded failure with `steps:null`, so
it is **NOT_EXECUTED**, not a code-test failure. Current branch requires
stepful exact-head Node 22 / Chrome execution, source and artifact SHA
checks, and owner/effect/compiler review before it can merge. **No private
source mirroring to another GitHub organization** without independent
source transfer authorization and destination allowlisting.
