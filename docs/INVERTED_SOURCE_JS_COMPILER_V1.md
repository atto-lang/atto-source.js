# Experimental inverted-class source → JavaScript ESM v1

**DRAFT, opt-in only.** This is an executable **narrow source compiler** rather
than an assertion that the broader JS parser and compiler understand inverted
classes. It is stacked on JS runtime PR #97 and its parent #35, #34, #27.

API: `compileInvertedSourceV1(source, {runtimeSpecifier})` exports an ESM
source string. Default runtime location `./worker-inverted-array.mjs` is
relative to the emitted module. Tests supply an explicit trusted `file:`
specifier and execute that *actual ESM* with Node's module loader; this is
not string-rewriting the emitted guest program. The default scalar `compile` API stays unchanged; the existing
`compileProgramV2` API now accepts **only host-authorized**
`{experimentalInvertedV1:true, runtimeSpecifier:"file:/trusted/..."}`.
Without this opt-in, inverted source still fails closed. The CLI has **no**
inverted flag yet: this is a library API integration, not a shipping CLI route.

## Accepted source fragment

```oreslang
define inverted class Particle as
    int id;
    float x;
    bool ready;
end

define pub fnc main(): int {
    let rows = InvertedArray<Particle>.with_capacity(3);
    let a = rows.push(Particle { id: 20, x: 1.5, ready: true });
    let b = rows.push(Particle { id: 22, x: 2.5, ready: false });
    return rows[0].id + rows[b].id;
}
```

This opt-in parser currently allows **one** nominal inverted declaration,
one public, zero-argument, synchronous `main(): int`, no extra declarations,
and bounded statements. Fields: `int`/`i64`, `float`/`f64`,
`bool`. Statements: static `with_capacity(N)`, source-typed scalar
`push`, `erase_swap(h)`, typed indexed field `=` / checked `i64 +=`, and an i64 return
expression of checked integer literals or indexed `i64` fields with `+`.

The parser now produces **versioned, detached, strictly validated typed IR**
with owner slots, field ordinals, scalar types, and checked expression nodes.
The emitter rejects unknown or forged IR shapes, cross-owner handles, invalid
field types, malformed literals, and post-return instructions, before
generating private numeric locals and nominal `InvertedSchema` tokens.
Direct IR entry: `compileInvertedIRV1(ir, {runtimeSpecifier})`;
source IR entry: `compileToInvertedIRV1(source)`.
This IR is a **backend-local staging seam**, not canonical shared HIR/MIR.
`rows[i]` is a current-dense positional lookup and `rows[h]` uses an
opaque generation-checked handle bound to the exact declared owner. No
reflection, string macro, implicit AoS row storage, dynamic fallback,
await, Task capture, source column loans, classes with nested resources,
arbitrary methods or array growth are accepted. Multiple nominal class
declarations, callbacks, non-i64 `+=`, and borrow escapes remain rejected.

The generated `main` uses `try/finally` to close every array even when
checked i64 math or positional access traps. The row expression used when
calling `push` is a transient scalar value, not permanent AoS storage.

## Verification and release holds

Copied six fixture blobs verbatim from conformance PR #195; per-blob SHA-1
is asserted in the Node suite. Both positive fixtures should return `42n`
from compiled guest ESM. All four negatives must throw a compiler error
before any emitted JS is returned. **Note:** these negatives currently prove
fail-closed subset rejection, *not* a general borrow/type-checker proof.

Isolated V8 compilation and generated guest execution are preliminary
evidence only. For promotion run, at the **exact PR head**:

```sh
npm run test:inverted
npm test
npm run test:workers
npm run test:browser
```

Require real Node 22 test-runner, browser Worker execution, source/guest
artifact SHA provenance and independent compiler/ownership review.
Source-org Actions jobs with `steps:null` are `NOT_EXECUTED`, regardless
of a failed conclusion. Cross-org private-source mirroring is forbidden
until the protected-source approval and destination-carrier allowlists
explicitly permit it.

Source-level support elsewhere in the general JS compiler remains gated.
LLVM/Wasm/.NET/Forge still need their own actual compiler/guest execution.

## Ownership and effect boundary

The typed IR validator tracks the nominal type of each allocation slot,
same-owner generation-checked handle references, **direct use-after-erase and double-erase rejection**, and the declared type of every access.
It limits control flow to one synchronous `main` with mandatory terminal
return and deterministic resource retirement. All source loans, suspensions,
captured mutable row views, external callbacks and field methods are rejected
rather than admitted without a lifetime/effect analysis. These checks are
**not** a full Oreslang borrow checker.

The normal `program-v2` and old scalar entry points never dispatch to this
implementation unless the host expressly passes the experimental option.
Under this opt-in the inverted parser is authoritative; scalar source is not
silently reinterpreted by its fallback parser.

New Node checks in `tests/inverted-typed-ir-v1.test.mjs` exercise
source→typed-IR→validated ESM, frozen conformance fixtures, hostile IR,
type/ownership spoofing, and legacy compiler default behavior. Real Node and
browser Worker execution must be recorded from exact PR head before
promotion. No private branch is sent to an unapproved CI carrier.

The direct-handle retirement checker is limited to this straight-line v1 IR: it
proves only direct handle consumption after `erase_swap`, not aliasing,
callbacks, borrow lifetimes, nested scopes, or concurrent actor ownership.

## Exact-head Node Worker admission gate

This stacked branch adds `tests/inverted-worker-node.test.mjs`, which compiles
the two shared positive fixtures into temporary, read-restricted ESM files,
loads them using actual Node 22 worker_threads actor instances, calls the
generated `main` twice per Worker (proving fresh ownership per call), and
checks both answers equal `42n`. It rejects all four negative source
fixtures before a Worker artifact can be created. Worker retirement and
temporary-file cleanup are mandatory; a rejected close fails the test.

The CI workflow runs `npm run test:inverted` as a named exact-head step
and `npm test` also includes the new test. `test:workers` includes it
as well. These steps are **authored, not yet evidenced as executed**.
A run that stays queued or produces failed jobs without recorded steps
is `NOT_EXECUTED`, not proof of failure or success of the implementation.

Generated row literals emit computed own-data keys for every nominal field,
including `["__proto__"]`; a regression checks that the field remains
a scalar and does not mutate the JavaScript row object's prototype.

The explicit trusted `file:` runtimeSpecifier is required for temporary
ESM files generated outside the source tree. Browser Blob ESM imports require
a separate audited trusted runtime URL policy and remain **unverified**.
