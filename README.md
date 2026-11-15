# atto-source.js — browser worker transpiler (strict subset)

This experimental JavaScript backend emits an ES module with `create_tenant({tenant,generation})` and `on_message()`, compatible with [atto-browser](https://github.com/atto-lang/atto-browser). It does **not** implement the full AttoLang language or general actors yet.

Supported in v1: a single `pub fnc main(): int { return EXPRESSION; }` (or non-public `fnc`) with decimal signed 64-bit integers, unary minus, parentheses, addition, subtraction and multiplication. Every arithmetic operation is overflow-checked with `BigInt`; unsupported syntax or source-injection attempts fail closed. Max source: 64 KiB, max tokens: 4096, max recursion depth: 64.

```js
import { transpile_to_worker } from './src/transpile-worker.mjs';
const {module_source} = transpile_to_worker('pub fnc main(): int { return 6 * 7; }');
// Write module_source to a same-origin ES module URL, then start an
// atto-browser tenant with { backend:'js', trusted:true, entry:moduleUrl }.
```

The output is **trusted JavaScript**. Browser Web Workers do not sandbox hostile JavaScript running under the same origin. Do not use the JS backend for untrusted tenants; use a rigorously vetted Wasm sandbox and limited host imports instead.

Run `npm test` (Node 20+). Host-unit tests verify checked signed math, independent module instances, and unsupported-source rejection. Browser E2E, actor syntax/codegen and parity with the richer Rust compiler are not yet established.
