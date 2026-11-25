# Atto JavaScript freestanding Option/Result source

**Concrete working target only:** `Option<int>` and `Result<int,int>` in independently
compiled pure file-scoped `namespace core;` sources. These are real `.atto` sources, not JS helpers.
`compileFreestandingCore` now accepts the namespace-owned, module-free files
and preserves legacy `define module core` for existing consumers. The files
compile **separately** and export public functions directly (no runtime
namespace object), and are not automatically installed as `core/option`
and `core/result` imports. Namespace metadata never grants import authority.

`core/option.atto` offers `option_if_positive`, `option_is_some`,
`option_unwrap_or`, `option_map_add` and `option_to_result`.

`core/result.atto` offers `result_ok_if_nonnegative`, `result_is_ok`,
`result_unwrap_or`, `result_error_or`, `result_map_add` and
`result_to_option`.

- This compiler uses a checked, immutable, frozen and nominal tagged ABI
  for these scalar values; no JS `null` coercion or prototype duck-typing.
- `Some(0)` must remain distinct from `None`, and `Ok(0)` from `Err(0)`.
- Checked i64 overflow remains the compiler's responsibility.
- No generic `map`/`and_then` callbacks, `map_err`, nested `transpose`,
  affine-owner transfer, `?` propagation or composed library imports in
  this stage. **Fail closed** for unsupported types or effects.
- Guest ESM compilation and runtime execution are specified by
  `tests/core-option-result-source.test.mjs`. Its presence is not proof
  of current-head CI execution. NativeAOT/Wasmtime parity is not claimed.

This backend intentionally differs in source shape from Java/Graal and LLVM.
Public semantics for admitted concrete specializations must match.

## Borrow/affine parity admission boundary

This freestanding JS profile has **concrete immutable scalar** Option/Result
values, not generic `Borrow<T>` ownership or move-only class payloads.
Its `option_is_some` / `result_is_ok` queries can be repeated for
`Option<int>` and `Result<int,int>` without consuming those Copy-only
tagged values. The new source test checks that behavior against **actual
compiler-produced ESM** when Node CI executes.

New negative compiler tests insist that `borrow Option<T>`,
`borrow! value`, `take! value`, generic `Option<T>` and
`Option<Box>` are all **rejected**, rather than converted into unsound
host-side owner copies or accepted through a dynamic fallback. A syntax
rejection proves only unsupported capability, **not** correct affine
borrow checking. Promote borrow-safe generic support only after a typed
loan/provenance checker, native guest execution and explicit copy/move/drop
tests exist. This compiler and its source `.atto` modules stay independent
from Java/Rust/LLVM implementations. Until then these eight borrow
API/affine cases must remain unsupported *candidates*, not certified
parity passes. Source-org workflow failures with no actual runner steps
are NOT_EXECUTED.
