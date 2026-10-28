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

## Audit hardening: signed f64 zero

A separate numeric-parity defect was found while auditing this stack: source
`-0.0` was lowered to typed `f64` IR string `"0"`, silently converting
negative zero to positive zero. The compiler now retains the canonical scalar
encoding `"-0"`, the typed IR validator accepts only that specific negative
zero spelling, and guest ESM emits `-0`. It continues rejecting malformed
noncanonical scalar encodings such as `-0.0` and `-0e0` supplied as direct IR.

Regression coverage exercises source → validated IR → emitted ESM and
independently proves negative zero survives packed SoA push, indexed writes,
and swap-delete via `Object.is(value,-0)`. Isolated V8 evidence against exact
current test/runtime blobs: **11/11** authored runtime cases passed. This is
not an exact-head Node/browser job.

## Audit hardening: option-record prototype access

The opt-in program-v2 dispatcher and the direct inverted-IR ESM compiler
previously read compiler option fields through ordinary property access or
destructuring. Even when a caller supplied an empty, plain own-property
record, hostile `Object.prototype` getters could execute. Host options now
require data-only own property descriptors, and missing option names are
never resolved through the prototype. The direct inverted compiler also
rejects unexpected option fields and accessor entries.

The added regression tests deliberately poison inherited
`experimentalInvertedV1` and `runtimeSpecifier` getters, prove zero getter
execution, and check invalid options fail closed. This does not claim safety
against arbitrary Proxy traps provided by the trusted host, or authorize
untrusted plugins to supply compiler configuration.

Isolated V8 exact-source checks passed: 11/11 runtime cases, 6/6 shared
source fixtures (2 positive results + 4 negative compile rejections),
two compound/signed-zero semantics checks, three inherited-getter
dispatch checks with zero getter calls, and five invalid compiler
options rejected. These checks do **not** count as GitHub Actions,
`node --test`, or browser module Worker evidence.

The private source-tree CI mirror remains **blocked** under
[JS approval issue #103](https://github.com/ores-truffle-oreslang/oreslang-source.js/issues/103)
and [private-source incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22).
A previously verified source-free private carrier has available Node 22
and Chrome Workers, but no private source may be exported without
reviewed permission and effective source transfer controls.
