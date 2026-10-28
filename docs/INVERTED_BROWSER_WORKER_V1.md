# Experimental inverted-class browser Worker ESM gate

This draft adds a browser-specific **host-authorized** import shape to the
experimental `compileInvertedIRV1` and `compileProgramV2` path, stacked on
draft PR #102. The original source, type, ownership, checked i64, and
signed-zero semantics remain unchanged.

## Browser import contract

Blob ESM modules cannot use the existing relative runtime import specifier.
When running in a real browser, the trusted host may supply the single
absolute URL at `<current http(s) origin>/src/worker-inverted-array.mjs`.
Admission requires exact origin equality with `location.origin`, exact
runtime pathname, canonical URL serialization, no credentials, no query
and no fragment. Other remote/foreign-origin paths fail closed.
Guest `.ores` source has **no authority to select the runtime URL**.

The source-compiled browser fixture defines a nominal inverted `Particle`
schema, pushes an `i64`/`f64`/bool row including `-0.0`, applies checked
`rows[h].id += 5` and returns `42n`. The browser smoke verifies:

- generated ESM loads in the document and returns `42n`;
- a real browser `type: 'module'` Worker calls the compiled `main`;
- two sequential calls each allocate a fresh SoA owner and return `42n`;
- the foreign-origin runtime import option is rejected before emission;
- spawned Workers are closed and temporary Blob URLs revoked.

Node source-unit regression tests additionally check same-origin canonical
admission and six malformed/remote import negatives while restoring the
mocked `globalThis.location` in a `finally` block.

## Verification and security restrictions

**Source-free carrier proof, not Oreslang source execution:**
[private Actions run 40611581115](https://github.com/cliptown/cliptown-e2e/actions/runs/40611581115)
completed all eight steps with actual Node v22.23.4, Google Chrome
156.0.8078.47 and `SOURCE_FREE_JS102_NODE22_CHROME_BLOB_IMPORT_PASS`.
The test used original synthetic module and Worker code and no Oreslang
private source. It establishes browser Blob-to-same-origin ESM loading only.

The experimental Oreslang-generated browser fixture is **authored but not
executed by a stepful source test** because source-org Actions still fail
before executing steps. Never claim this new test is green without its own
exact-head run. This PR stays DRAFT. No code was copied to a secondary
organization. The independent source-transfer authorization remains pending
under [source issue #103](https://github.com/ores-truffle-oreslang/oreslang-source.js/issues/103)
and [security incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22).

Do not change or repin PR #102's existing approval SHA to this draft child:
a future source-bearing CI request must explicitly authorize the **new**
exact source commit/tree if this child is included.
