# Inverted JS runtime v1 (draft; 2026-10-27)

**Scope:** host-only checked runtime on top of the Worker-private `WorkerMixedLayout`
introduced by PR #35. The existing `InvertedRowIndex` on JS `main` is
imported and hardened. This draft is stacked on #35, which itself is stacked
on #34 and #27. It must not merge independently of its parent implementations.

## Supported runtime slice

- Nominal `InvertedSchema` instances mint opaque, immutable field bindings.
  A new schema with the same name/fields is **not** an interchangeable authority.
- One authoritative `soa` physical image, backed by the same checked layout
  offsets as the existing mixed-layout Worker storage; scalar `i64` (signed
  BigInt64), `f64`, and canonical 1-byte `bool` are admitted.
- `WorkerInvertedArray` can be owned by a Worker actor, a Task scope or ordinary
  code. An actor is not required. No mutable backing ArrayBuffer is exported.
- Positional `readAt/writeAt` use current dense order. Issued row handles use
  private issuer identity, live slot and generation checks, including swap-delete.
- Failed row shape/type validation or handle issuance does not publish a live row.
  Newly used physical tail cells are scrubbed on rollback and erase-swap.
- Read/read loans coexist; write loans exclude all other loans on a field. A
  structural mutation excludes *every* outstanding field loan. Retire revokes
  all handles/loans and scrubs the physical bytes.
- `addF64At` is a synchronous closed primitive operation. No callback, await,
  dynamic dispatch or concurrent worker interleaving occurs within its turn.

## Explicit exclusions

**Not source-language admission.** JS compiler entries must continue rejecting
`define inverted class` until a typed parser, nominal type checker, exact-site
ownership/effect analysis and source-to-ESM emitter are implemented.

This first slice has a **fixed positive capacity** at construction. Allocation
failure, resizing, alignment across external FFI, fixed-layout POD records,
unbounded `InvertedArray`, guest column borrows and source `+=` are not
claimed. `addF64At` does not authorize guest compound syntax. The host APIs
are not a same-realm security membrane: only the compiler can authorize
synthetic nominal bindings as guest code; untrusted JS cannot run in the
trusted host module realm.

This JS implementation uses V8-managed memory. Private Workers are isolation
domains for mutable actor state, not an OS sandbox.

## Required verification

- Exact-head Node 22 `node --test tests/worker-inverted-array.test.mjs` and
  `npm run test:workers`, plus real browser Worker checks after integration.
- Re-test JS `main` index behavior and stacked #34/#35 layout tests after
  rebasing. Test atomically issued handles with a controlled failure injector.
- Authoritative real compiler positives and compile-negatives for
  `InvertedArray<T>`, ownership escape, suspension, nominal mismatches, and
  checked indexed field read/write **before** any source-level promotion.
- The existing private-source CI carrier policy applies. A private test org
  and hash pinning alone do not authorize cross-org mirroring.
