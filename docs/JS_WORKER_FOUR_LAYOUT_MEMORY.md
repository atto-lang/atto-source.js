# Worker-private four-layout actor storage

The JavaScript backend's physical isolation mechanism is the dedicated browser Web Worker / Node worker thread. Mutable guest data owned by an actor should stay inside that Worker's heap; actor messages carry copied/transfer-owned values rather than live references into another Worker's storage.

`WorkerLayoutF64` is a bounded host/runtime substrate for dense data-oriented storage inside one Worker. It supports four distinct geometries: AoS, SoA, tiled AoSoA and grouped SoAoS. The backing `ArrayBuffer` and `Float64Array` are private fields and are never returned. Column snapshots are plain copied arrays.

This slice is not source-level `define actor`, `inverted class` or ECS lowering. It also does not make a Worker an OS security sandbox. SharedArrayBuffer remains outside this actor-private store and requires a separately reviewed shared-memory capability.

`actor-compressed32.mjs` mirrors the Java/LLVM/.NET/Wasm actor-relative representation for future compiler-generated packed references. It is a representation only, not a JS object reference, ActorRef or capability.
