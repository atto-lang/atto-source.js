# Return-first callable syntax in the JS scalar source frontends

This change admits only **concrete `int`** return-first scalar callables
(`fnc int <- name(...)` and `int • name(...)`, optional `begin/end` or
brace body) into the existing scalar-v1 and program-v2 parser paths.

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
