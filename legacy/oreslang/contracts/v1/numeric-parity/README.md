# Portable signed-i64 source parity (experimental JS checked profile)

This directory mirrors the immutable seven-case portable signed-i64 expression
manifest (`bbc319c19ecd007109d33592e210091eb267e5a2`) used by the .NET
typed IR/CIL reference checker and the Wasm real-LLVM guest test. Its four-case
non-wrapping overflow manifest (`2ce0b0ff5c52e54a788280fd64d67fa8dc32614a`)
matches the signed-i64 overflow expressions exercised in the .NET CIL gate
and recorded by the Wasm numeric contract.

`node --test tests/shared-checked-i64-parity.test.mjs` compiles all 11
reviewed expressions with **JS program-v2** using the explicit
`// oreslang:checked-i64-v1` source profile, executes the emitted ESM,
checks seven exact signed-i64 `BigInt` results and four runtime overflows,
and pins the Git blob identity of both JSON manifests.

These manifest bytes do **not** imply full-source-byte parity: the JS test
constructs an opted-in checked-profile source header that is not present in
all bootstrap native frontends. The check provides no native LLVM, Wasm guest,
.NET Native AOT, actor-safety or production certification evidence. The older
JS **scalar-v1** compiler still wraps on overflow and is intentionally not
counted as checked-i64 parity. CI must actually execute on the exact PR head.
