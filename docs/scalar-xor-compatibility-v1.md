# AttoLang scalar XOR: legacy JS migration reconciliation

**Scope:** the explicitly trusted, signed-i64 *single `main(): int`* source-to-Worker-ESM subset in `src/transpile-worker.mjs`.
**Status:** experimental backend implementation against a *proposed* normative language contract. Not general compiler, Boolean expression, multi-tenant isolation, or all-backend conformance.

## Source contradiction

- Legacy `ores-truffle-oreslang/oreslang-source.js#218` called `^` and `^^` **removed operators**, while separately implementing `--atto-scalar-v1` over `src/atto-scalar-v1.mjs`.
- Merged legacy JS `#230` reserved both source operators in both scalar frontends in favor of `Integer.bitXor(a,b)` and `Xor(a,b)`.
- Merged legacy JS `#217` had *already* provided `--atto-scalar-v1` / `compileAttoScalarV1` inside `program-v2.mjs`. Avoid introducing those two competing compiler front doors here.
- Canonical `atto-lang/atto-spec#93` corrects the accidental language-wide ban. Merged `atto-spec#87` proposes typed `int ^ int -> int` and distinguishes `bool ^^ bool -> bool`. The bitwise contract remains **proposed**, with cross-backend execution parity pending.

## This backend's deliberately narrow resolution

- Accept infix `^` **only** in the already int-only trusted scalar subset. Lower to BigInt XOR under existing signed-i64 checked emission; preserve left-to-right evaluation and precedence below addition/multiplication.
- Recognize contiguous `^^` as the separate Boolean XOR operator but reject it with `E_UNSUPPORTED_BOOL_XOR` because this frontend cannot type-check or lower Boolean expressions. This does **not** mean AttoLang removed the operator.
- Keep `%`, unimplemented `&`, `|`, shifts, leading-caret return shorthand and all broader expressions fail-closed. No new token grammar for actor receivers, no untrusted JS sandbox, no claims about Java/LLVM native guest execution.
- Do not port either legacy `--atto-scalar-v1` implementation. The existing canonical `transpile_to_worker` entry point remains the only admitted scalar/actor host pathway for this subset.

## Proof obligations and overlap

`node --test tests/scalar-xor-contract.test.mjs tests/transpile-worker.test.mjs`, followed by `npm test` on a **clean exact PR head** with Node 22+. The tests exercise generated ESM guest modules and negative frontend admission, not protected process isolation. Confirm executed steps, immutable HEAD/tree, and independent reviews before merge.

`atto-source.js#31`, `#38`, `#42` and `#43` also edit `src/transpile-worker.mjs`. Their actor/Result/Mutex changes are **semantically separate** but share the file; rebase/integrate and re-run the combined executable suite rather than force-merge. `#41` adds an independent functional compiler and CLI and should not be overwritten.

**Source-only migration:** no legacy private-source blobs or whole Git trees were transferred. This implementation follows the publicly stated semantic contract and existing canonical code.
