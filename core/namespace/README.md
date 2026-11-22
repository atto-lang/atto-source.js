# JS namespace-first Atto core scalar guest profile

The JS experimental compiler now recognizes `use namespace cmp;`
(and the prior `namespace cmp;` flat form). The **independent** pure
Atto source files are in `core/namespace/{slice,iter,cmp}.atto`.

Call `compileCoreNamespace({source, expectedNamespace})` with explicit
source bytes. The helper never opens files, resolves relative imports,
fetches packages or treats the namespace string as authority. It
compiles real guest scalar functions through the program-v2 IR and ESM
emitter. This limited profile does not replace the existing full staged
`core/{slice,iter,cmp}.atto` algorithms, and it is **not** a verified
`atto.core/*` package importer, real ownership checker, `Slice<T>`,
`Iterator<T>`, generic `Array<T>` implementation or NativeAOT backend.

`tests/core-namespace-scalar.test.mjs` is a direct compiled-ESM guest
test and checks negative imports, namespace mismatches and bounds.
The source-level namespace is metadata; exported guest functions are
ordinary ESM functions, not a runtime namespace object.
