# Return-first callable syntax in the JS scalar source frontends

This change admits only **concrete `int`** return-first scalar callables
(`fnc int <- name(...)` and `int • name(...)`, optional `begin/end` or
brace body or bare `return...; end`) into the existing scalar-v1 and program-v2 parser paths.

Both forms lower to the **same existing validated IR and emitted ESM** as
`fnc name(...): int`. Do not infer broad functional/actor/effect support,
arbitrary source parsing, or runtime tenant isolation. No unchecked conversion
or compiler fallback is introduced. Non-`int` return-first syntax remains
unsupported by this narrow source profile.

Execute:
```sh
node --test tests/return-first-scalar-parity.test.mjs
```
The positive tests compile and execute deterministic scalar JS guests;
the negative suite rejects invalid return-first headers, omitted bodies and
unsupported exception bangs. The exact PR-head Actions and independent
review gates remain necessary before claiming release-level parity with
GraalVM, LLVM, Wasm or .NET.

This PR is **stacked on exceptional keyword PR #73** to avoid conflicting
same-file lexer patches; the separate draft lambda PR #76 also touches the
scalar frontend, and its implementation must be reconciled before any merge.

## Bounded extension: void and proven int inference

The program-v2 compiler also accepts return-first `void` for empty or bare
`return;` pure functions, with no side effect statement lowering. The scalar
compiler continues to reject void. Both scalar and program-v2 now accept
`infer <- f(...) {return ...;}` only when the returned expression is
provably an int literal, typed int parameter, or a pure `+`, `-`, `*`
composition; unknown calls, booleans, effects and ambiguous inference
fail closed with `INFER_UNSUPPORTED`. Infer is **not** an implicit int cast.

This supports shared int return-first/infer fixture declarations but does not
pass all shared void fixtures, whose `main` uses effectful call statements not
implemented in the bounded program-v2 parser. Actual source-compiled guest
results must be distinguished from source-free/type-only CI checks.
