# AttoLang operator spellings — JS subset and legacy reconciliation

**Resolution (2026-11-20):** `^ expression;` is return shorthand, never exponentiation or XOR. `^^` is typed integer bitwise XOR; `<<<` and `>>>` are integer shifts; `<<` and `>>` are read/write operators. Exponentiation is an explicit `Math.pow(base, exponent)` API call, not an operator.

## Semantic source of truth

This implementation tracks the user-selected grammar documented in the companion `atto-spec` operator-spelling reconciliation. That specification remains a **proposed** normative contract until reviewed; implementation evidence is per-backend, not proof of full language parity.

| Form | Intent | Present trusted `transpile_to_worker` subset |
| --- | --- | --- |
| `return 5;` and `^ 5;` | Same callable return | Both compiled |
| `12 ^^ 10` | int bitwise XOR, result 6 | Compiled to checked signed-i64 BigInt XOR |
| `8 <<< 2` | left shift, result 32 | Compiled with signed 64-bit wrap |
| `-1 >>> 1` | logical right shift, result 9223372036854775807 | Compiled with unsigned intermediate / signed output |
| `stream >> val item` and `sink << value` | Trait-checked read/write | `E_IO_UNSUPPORTED` in this numeric guest |
| `Math.pow(2, 3)` | Explicit exponentiation API | Fail-closed: general Math API not linked |
| `12 ^ 10` | Invalid infix use of return marker | Rejected |
| `true ^^ false` | No implicit bool-to-int XOR | Rejected by the int-only backend |

Shift-count masking to the low six bits is the **proposed** bitwise v1 policy and needs cross-backend approval. Shifts preserve the 64-bit result bit pattern; only checked arithmetic `+`, `-`, `*` traps on signed overflow in this restricted compiler.

## Source contradictions and disposition

- Legacy `ores-truffle-oreslang/oreslang-source.js#218` used the same `--atto-scalar-v1` front door as merged legacy `#217` with different implementation paths. Neither duplicate frontend is copied into the Atto target.
- Legacy merged JS `#230` reserves both `^` and `^^`, replacing them with named functions, which contradicts this newly selected syntax.
- Earlier `atto-spec#87` described `a ^ b` as integer XOR while `atto-spec#6` proposed `^^` as Boolean XOR. The corrected spec distinguishes **statement-leading return** from **typed int `^^`**; #6 requires an explicit separate Boolean-operator reconciliation. This PR does not silently redefine Boolean semantics in the backend.

## Implementation and safety boundary

The compiler admits only a single checked signed-i64 `main(): int` expression (or its existing restricted actor form) and emits a trusted Worker ESM module. Lexing uses maximal-munch `^^`, `<<<`, `>>>`, `<<`, `>>` to avoid accidental reinterpretation. Both return spellings normalize at the **statement parser**, not by preprocessing string replacement. No code text is spliced into generated JS; unsupported syntax remains fail-closed.

The `<<`/`>>` design applies to streams, channels and any statically verified readable/writable interface or trait, subject to capability, effect and lifecycle constraints. The JS numeric subset **does not execute** these I/O operators. `Math.pow` type/rounding/overflow rules require the separate standard Math contract, so no guessed integer or floating-point semantics are implemented here.

`atto-source.js#31`, `#38`, `#42` and `#43` overlap the target compiler file. Merge/rebase deliberately without discarding their unique actor, Result or Mutex work; `#41` is an independent functional-source CLI.

## Verification and publication

Focused Node 22 execution on the exact PR SHA is required:

```sh
node --test tests/scalar-xor-contract.test.mjs tests/transpile-worker.test.mjs
npm test
```

Verify the exact checkout HEAD/tree, real executed job steps, immutable source blobs and independent review. A V8 in-memory model with a substitute ASCII byte-count function, if run, is **not** Node 22 test evidence. No native AOT, protected TenantVM, generalized actor, Math.pow or cross-backend parity is claimed. Keep this PR Draft pending execution and integration review.

Nested generic type closers `>>` or `>>>` are parsed as individual type
delimiters in recognized generic contexts; outside, `>>` remains typed
channel read, unsupported here. The distinction is needed for nominal
resource constructors from JS PR #43 without silently admitting I/O.
