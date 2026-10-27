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

Local Node 22.16.0 execution on October 27, 2026 passed all **ten**
unit tests with zero failures/skips. A private-scope security audit reproduced
a defect in the initial five-test version: the public constructor accepted a
caller-controlled slot allocator and scope depth. These inputs could forge
duplicate/negative slots and reset the nesting budget. The hardened constructor
derives both from a privately branded parent; it rejects extra arguments,
forged instances, and excessive nesting. A private lexical lookup also prevents
an overridden public `resolve` method from bypassing shadowing rejection.

An additional regression enforces the 192-level nested-const lowering budget before producing a deeply nested IR candidate. The final local source/test Git blob SHAs match the committed files:
- `src/lexical-const-v0.mjs`: `5097ada9e838fce6dd934c48806c3916971a56ca`
- `tests/lexical-const-v0.test.mjs`: `cb4805049dfcfa03166657a3c7fbc25c3beb15e7`

This is **local two-file isolated execution**, not source-org GitHub Actions
execution or a full compiler test. Do not generalize these results to PRs
#93/#94 or infer that program-v2 has integrated lexical const source syntax.

This does **not** establish the experimental JS transpiler's feature parity
with Java, LLVM, WASM, .NET or Forge. It also does not authorize moving
private source to another organization for CI. Before integration or merge,
run an authorized **source-local** exact-head test and independent review.
