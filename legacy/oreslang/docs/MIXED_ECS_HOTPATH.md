# Mixed-width ECS kernel: allocation-minimized hot path

Status: **draft JS runtime optimization**, not measured end-to-end Oreslang guest performance.

The original `WorkerMixedLayout` called `MixedLayoutGeometry.address(row, field)` for every scalar, freezing an address descriptor and constructing BigInt coordinate calculations in the inner loop. That defeats the primary purpose of SoA/AoSoA/ECS cache-optimized storage.

This branch introduces `offsetAt(row, field)`, which checks the exact same row/field and segment bounds but returns one primitive byte offset. The private geometry stores numeric coordinates only **after** full BigInt physical-byte admission has established that offsets fit within 256 MiB. Cold diagnostic `address()` remains frozen and complete, for debugging and conformance checks.

`WorkerMixedLayout.read/write/integrate` now operate directly on private `DataView` bytes and never create frozen address objects per component. The integration loop keeps separate valid `f64` fields and exact actor-private storage, and does not produce temporary row arrays.

**Checks:** exact authored JS sources were executed in isolated V8: 378 differential/assertion checks passed over aligned heterogeneous four-layout address geometry and actor storage. This is not Node Worker or browser guest execution. A committed `node --test` regression overrides the diagnostic address method and proves the kernel does not call it.

**Still missing:** real Node/browser Worker executed tests on an independently admitted CI runner; compiled Oreslang source that reaches this kernel; profiling of CPU cache misses, allocation counts and throughput; and proof that underlying host operations remain allocation-free. `offsetAt` performs ordinary RangeError admission; these errors may allocate if thrown, which is outside the admitted fast path.
