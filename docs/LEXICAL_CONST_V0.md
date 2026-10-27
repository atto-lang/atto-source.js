# JS lexical const v0 — compiler-only foundation

This is an **independently tested prototype**, not source-level `const` support in `program-v2`.

- `src/lexical-const-v0.mjs` defines an immutable lexical binding/slot model and
  lowers a narrow `const` + `return` statement sequence to a nested
  `localDecl` *candidate* AST. It does not bypass or extend the existing
  program-v2 IR validator.
- Supported provisional local domains are `int`, `bool`, `symbol`,
  `option<int>`, and `result<int,int>`. Local names cannot shadow parameters
  or surrounding locals. Identifiers, scope depth (192), binding count
  (30,000), and parameter count (128) are bounded.
- Locals allocate distinct numeric slots within their lexical family.
  Child bindings do not escape to parent or sibling scopes.
- `lower_const_sequence` preserves initializer-before-continuation ordering,
  rejects unreachable/malformed returns and accessors on statement records,
  and does **not** infer types or generate ESM.

**Still pending:** source parser admission, function/method local type checking,
validated `localRead`/`letLocal` program IR, emit-once code generation,
closure capture/escape, mutable `let`, borrowing and suspension restrictions,
and exact-head compiler/browser/sanitizer acceptance.

## Verification

```sh
node --test tests/lexical-const-v0.test.mjs
```

A source-identical local Node 22.16.0 run on October 27, 2026 passed all five
unit tests with zero failures/skips. Git blob SHA comparisons matched
the committed source/test bytes.

This does **not** establish the experimental JS transpiler's feature parity
with Java, LLVM, WASM, .NET or Forge. It also does not authorize moving
private source to another organization for CI. Before integration or merge,
run an authorized **source-local** exact-head test and independent review.
