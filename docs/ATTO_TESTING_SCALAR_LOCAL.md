# JS compiler-local AttoLang scalar assertions (candidate)

This JS compiler maintains its own `.atto` implementation in
`stdlib/testing_scalar.atto`. It intentionally does **not** import the
Java or LLVM library source and is not a shared canonical blob. Public
scalar semantics are compatible with the LLVM M0 status contract:

- `equal_int`, `not_equal_int`, `greater_than_int`,
  `less_than_int`, `in_range_int`, and `combine_status`.
- `0` means the assertion passed; `1` means it failed.
- `greater_than_int` and `less_than_int` use **strict** comparisons.
- `in_range_int` accepts both endpoints, rejects inverted bounds,
  and never increments or subtracts a bound. All arithmetic is
  compatible with checked signed-i64 execution.
- Every function is pure and requires no heap, filesystem, scheduler or
  host test-runner callback.

The source-linked JS guest test, `tests/testing-scalar-atto-guest.test.mjs`,
reads the actual compiler-local `.atto` file, appends a deliberately small
`main()` function and compiles the combined Atto source with
`compileProgramV2`. Its unit cases **execute the generated ESM** through
Node and compare guest-returned signed-i64 BigInts.

```sh
node --test tests/testing-scalar-atto-guest.test.mjs
```

This is a candidate integration. No executed exact-head CI is claimed
without a real, stepful job. The JS compiler has not been proven to
resolve the implicit `std/testing_scalar` import from this file; source
concatenation in the host test is not a substitute for importer wiring.
There is no `TestOutcome`, `TestCase`, `TestSuite`, guest `ORES_TEST`
receipt emitter, property runner, actor scheduler control or AOT image
parity in this milestone. Java's richer outcome-based API is **not**
forced into this backend: compatible scalar semantics suffice here.

Before promotion, run the full node test suite and real guest checks on
the exact head. Record unsupported features as unsupported, not pass.
