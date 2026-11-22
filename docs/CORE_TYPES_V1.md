# core/types v1 — JavaScript backend

Independent backend-owned `core/types.atto` source, with no imports from any other compiler backend or shared canonical library tree.

The public `types` module supplies `int_value_bits=64`, `bool_value_bits=1`, `byte_value_bits=8`, signed i64 minimum/maximum, and `fits_i8/i16/i32/i64/u8/u16/u32/u64(int)` range predicates. These check representability of **signed int inputs**. They are not conversions and do not establish sized integer compiler support, ABI storage widths or memory layout. Do not use host Number/BigInt reflection as a silent replacement for Atto nominal identities.

`void` is valueless, not `Unit`. First-class `Unit`, opaque compiler-minted `TypeId`, `TypeInfo<T>` static metadata and checked scalar lowering require independently audited compiler work and are not claimed by this library slice.

Guest acceptance target: link `tests/fixtures/core-types-v1/edge-positive.atto` against this actual module and execute exit 0; reject `void-value-negative.atto` before emission. Record toolchain/target and exact head with nonzero CI steps. **NOT_EXECUTED:** no guest or AOT proof for this PR; unsupported targets must report unsupported explicitly.

## Namespace-only core source

Canonical `use namespace types;` file header plus public top-level functions; no `define module` wrapper. Consumers still explicitly import the symbols. Compiler parse, namespace source identity, static imports, and executed linked guests require separate proofs. Until the current PR compiles and runs, namespace guest parity remains NOT_EXECUTED.

## Native JavaScript compiled guest gate

The production program-v2 source parser accepts the file-scoped `use namespace types;` header as metadata and `&&`/`||` as lazy boolean aliases. It emits the independently owned `core/types.atto` as real ESM exports, without inventing an import/linker or rewriting source to a module wrapper. `tests/core-types-compiled-guest.test.mjs` imports the actual generated ESM and validates 13 exports, widths, signed-i64 endpoints, more than 208 boundary function calls, invalid host values and malformed source forms. This is compiler-emitted **JS guest** evidence only when the test actually runs. The existing eight imported-file negative fixtures still require a verified multi-file linker before they can be counted as correct compiler diagnostic parity. No NativeAOT, Wasm or external package resolution is asserted.
