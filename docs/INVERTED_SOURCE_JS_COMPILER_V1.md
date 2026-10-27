# Experimental inverted-class source → JavaScript ESM v1

**DRAFT, opt-in only.** This is an executable **narrow source compiler** rather
than an assertion that the broader JS parser and compiler understand inverted
classes. It is stacked on JS runtime PR #97 and its parent #35, #34, #27.

API: `compileInvertedSourceV1(source, {runtimeSpecifier})` exports an ESM
source string. Default runtime location `./worker-inverted-array.mjs` is
relative to the emitted module. Tests supply an explicit trusted `file:`
specifier and execute that *actual ESM* with Node's module loader; this is
not string-rewriting the emitted guest program. The regular `compile` and
`compileProgramV2` commands are deliberately **not changed**.

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
`push`, `erase_swap(h)`, typed indexed field `=`, and an i64 return
expression of checked integer literals or indexed `i64` fields with `+`.

The parser produces checked structured field/owner/index bindings, then
emits private numeric locals and statically bound `InvertedSchema` tokens.
`rows[i]` is a current-dense positional lookup and `rows[h]` uses an
opaque generation-checked handle bound to the exact declared owner. No
reflection, string macro, implicit AoS row storage, dynamic fallback,
await, Task capture, source column loans, classes with nested resources,
arbitrary methods or array growth are accepted. Multiple nominal class
declarations, callbacks, source `+=`, and borrow escapes remain rejected.

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
