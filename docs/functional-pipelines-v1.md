# JavaScript compiled functional pipelines — restricted Atto guest v1

**Status:** source compiler and canonical guest fixtures committed. Four real guest ESM modules, each generated from the exact local source, were executed under Node 22.16.0 before this PR. The locally executed compiler Git blob SHA was verified against the committed GitHub content as `2d3cd3a30e6cd41bcd7eac0294053ff3e77ccd99`. This is **local execution**, not GitHub Actions admission or proof of a secure TenantVM.

## Usage

```sh
node bin/atto-jsc.mjs --functional-source --check examples.atto
node bin/atto-jsc.mjs --functional-source examples.atto --out=/absolute/path/guest.mjs
node --test tests/functional-pipeline-guest.test.mjs tests/functional-pipeline-cli.test.mjs
```

The source is tokenized, parsed, type/arity/cycle checked, then lowered to **generated pure JavaScript ESM functions**, not interpreted by the compiler. The generated `main()` returns signed i64 as a `BigInt`, with checked range enforcement after every arithmetic step. The Node test harness imports the emitted module in a **new process**, executes its actual `main()`, and records the observed return value. Generated guest code contains no imports, eval, dynamic Function, filesystem, network, or ambient OS capabilities.

## Scope

Accepted: bounded ASCII `.atto` code, named `fnc` functions, zero to eight typed signed-int64 parameters, `: int { return expression; }` explicit return, `: int -> expression;` single-expression body, four immutable sequential `val` locals before final return, checked `+`/`-`/`*`, direct statically resolved calls, forward `|>` (left-associative), reverse `<|` (right-associative) and explicitly parenthesized mixed directions. Signed `int64::MIN` is supported; positive unsigned-scale literals and arithmetic outside signed i64 are rejected or trapped. Unsupported async, actors, ownership/effects, other types, division, dynamic invocation, mutable locals, external imports, Unicode source and oversized source fail closed.

Four SHA-exact positive source fixture copies from `atto-spec#121` return **83, 83, 42, 42**. Four SHA-exact negative copies are rejected by syntax/type admission. The test suite also covers arity, call cycles, unknown functions, unsafe identifiers, source-security controls, negative no-artifact guarantees, int64 minimum and checked overflow.

This is independent **JS guest compiler support** but not full production language parity or a TenantVM trust boundary. The existing `atto-jsc` structural-subset modes are preserved. GitHub CI must run on the exact current PR head with nonzero executed steps and no stale fixtures before the conformance ledger can mark a backend passing. Security review must also cover confinement of executing guest modules, not simply the purity of their generated output.

Related: `atto-source.rs#381`, `atto-source.llvm#54`, `atto-source.net#16`, `atto-source.java#51`, `atto-source.forge#45`, `atto-source.cranelift#50`, `atto-spec#121`, `atto-platform-conformance#105/#112`.
