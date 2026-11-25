# Worker-private heterogeneous four-layout storage

Status: **JavaScript Worker runtime substrate**, not source-level Oreslang inverted-class or actor compilation.

`MixedLayoutGeometry` implements checked `u32`, `f64`, `bool`, `ref32` field geometry under exactly one authoritative layout: AoS, SoA, AoSoA (power-of-two tile width), or grouped SoAoS (independent arrays of compact subrecords). It aligns each field naturally, and aligns each segment's base to its strongest field requirement. `ref32` is only an unsigned encoded word and **does not permit memory dereference** without a separate actor-domain, generation, issuance, type and borrow proof.

`WorkerMixedLayout` owns a private ArrayBuffer/DataView; no live buffer or typed-array view escapes. An actor's Node Worker can hold it across turns and retire it deterministically by scrubbing bytes and revoking object access; the private heap's OS memory release still depends on the JS engine/GC. `snapshot` returns copied scalar values, not mutable memory. These methods are host-runtime hooks and **are not source-compiled Oreslang**.

Shared ABI golden example (field order: id:u32, x:f64, flag:bool, next:ref32; three rows, except five rows for tile-width four):
- AoS: 24-byte row stride, 72 bytes.
- SoA: four segments of 12,24,3,12 bytes; independent-alignment base padding makes the private **allocation** 56 bytes vs 51 bytes of field payload.
- AoSoA width four: two 72-byte tiles, 144 bytes, tail rows excluded from live entity count.
- SoAoS groups [[id,flag],[x,next]]: subrecord strides 8 and 16; allocation 72 bytes.

Limits are checked in bytes **before** allocating private buffers and include segment-base alignment and tile padding. No layout ever shares the same authoritative mutable field in multiple buffers. Tests include full physical-byte nonalias checks, IEEE signed zero/NaN and typed scalar checks, invalid geometry, and two independent Node Workers.

Unimplemented: guest `define inverted class` compilation, compiler-owned field borrow proofs, generational ECS row handles, immutable grant transfer, browser Worker parity and source-level produced ESM tests. Cross-target certification must wait for stepful exact-head CI and real generated guest execution. The new feature branch is stacked on JS Worker four-layout PR #34.
