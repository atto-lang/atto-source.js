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

Compiler-owned imports now have a deliberately narrow browser-safe entry:
`import fnc in_range_int from "std/testing_scalar";`. The compiler embeds
its own `.atto` library snapshot and validates an exact byte mirror; it
rejects forged paths, duplicate imported names, unknown exports and alias
collisions. Selected functions are private guest helpers and are not
implicitly published as ESM exports. The dedicated imported-source guest
suite and negative tests are `tests/testing-scalar-import.test.mjs`.
This is not arbitrary filesystem import resolution, a package graph linker
or a general implementation of `import module`.

The source-linked JS guest test, `tests/testing-scalar-atto-guest.test.mjs`,
reads the actual compiler-local `.atto` file, appends a deliberately small
`main()` function and compiles the combined Atto source with
`compileProgramV2`. Its unit cases **execute the generated ESM** through
Node and compare guest-returned signed-i64 BigInts.

```sh
node --test tests/testing-scalar-atto-guest.test.mjs
```

This is a candidate import implementation. The compiler now has a bounded
`std/testing_scalar` resolver, but no executed exact-head CI result proves
it runs successfully. The earlier source-concatenation tests are retained
as separate regression coverage; they do not replace the real imported
source tests and cannot certify general package linking.
There is no `TestOutcome`, `TestCase`, `TestSuite`, guest `ORES_TEST`
receipt emitter, property runner, actor scheduler control or AOT image
parity in this milestone. Java's richer outcome-based API is **not**
forced into this backend: compatible scalar semantics suffice here.

Before promotion, run the full node test suite and real guest checks on
the exact head. Record unsupported features as unsupported, not pass.
