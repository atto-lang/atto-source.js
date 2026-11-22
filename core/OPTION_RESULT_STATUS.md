# Atto JavaScript freestanding Option/Result source

**Concrete working target only:** `Option<int>` and `Result<int,int>` in independently
compiled pure `core` modules. These are real `.atto` sources, not JS helpers.
The deliberate `define module core` name is required by
`compileFreestandingCore`: the two files are compiled **separately**, and
are not a single composed module or automatically installed as `core/option`
and `core/result` imports.

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
- Actual guest ESM compilation and runtime execution are covered by
  `tests/core-option-result-source.test.mjs`. Its presence is not proof
  of current-head CI execution. NativeAOT/Wasmtime parity is not claimed.

This backend intentionally differs in source shape from Java/Graal and LLVM.
Public semantics for admitted concrete specializations must match.
