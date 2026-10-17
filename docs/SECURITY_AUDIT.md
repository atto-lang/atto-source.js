# JavaScript backend audit — 2026-10-17

Status: **draft hardening changes; exact-head GitHub CI has not executed**.

## Audited trust surfaces

| Area | Finding | Response |
| --- | --- | --- |
| Package publication | A check-then-rename sequence could replace a concurrently created empty directory | Reserve the final output directory with exclusive `mkdir`; link the fully written module first and manifest last; reject collisions |
| Package admission | A manifest's own SHA-256 fields do not establish external trust | Require independently supplied, exact expected hashes for manifest, module and source, plus caller-pinned compiler SHA and target; verify schema and regular files before admitting |
| Package immutability | A filesystem path can change after hash verification | Document requirement for a trusted private output parent and immutable or sealed artifact before import; do not claim path verification is a sandbox |
| Namespace impersonation | JavaScript can forge `[object Module]` and a null prototype | Require a non-extensible namespace for basic portable misuse detection; provide a Node-specific API with the native `util.types.isModuleNamespaceObject` brand check |
| Integer ABI | Accessor-backed "JSON values" could invoke arbitrary getters; ordinary JS calls ignore extra arguments | Reject getters, symbols, noncanonical int64 data and wrong function arity (too few or too many arguments) |
| Numeric limits | The minimum signed 64-bit literal was rejected because its positive magnitude is out of range | Accept `-9223372036854775808` only through unary minus; keep positive `9223372036854775808` rejected |
| Resource limits | Compiled code size was not independently capped | Limit generated module to 4 MiB; verifier caps module and manifest reads; cap public ABI entrypoints at 128 |
| UTF-8 | `ignoreBOM:true` preserved a source BOM and broke the lexer | Decode strictly with leading BOM removed |

## Test evidence and limits

- Targeted dynamic compiler checks ran against the fetched exact GitHub source for arithmetic, the signed minimum, positive overflow rejection, oversized literals and deep expressions.
- Targeted host-bridge checks exercised signed-int64 round trips, non-invocation of accessors, simple forgery rejection and exact/missing/extra arity.
- Node 22 native `util.types.isModuleNamespaceObject` accepts a real module namespace and rejects a constructed module-tag impersonator.
- Read-only package admission exercised success, modified module bytes, modified manifest bytes and symlink rejection using stubbed filesystem/digest dependencies. **This is logic testing, not a full native filesystem/cryptographic integration run**.
- All changed production modules were syntax-checked with imports removed for dynamic parsing.
- The Node repository tests (`npm test`) and SHA-256 filesystem tests must run unmodified on an allocated runner; no green exact-head CI receipt exists yet.
- The conformance inventory includes JS positive/negative fixtures, but does not establish Java/Graal, LLVM or Wasm parity.

## Non-goals / open blockers

1. JS namespace brand checking does **not** prove source provenance: the host must pin and verify the exact approved artifact.
2. Neither V8, a Node worker thread, this bridge, nor `admitPackage` establishes a sandbox for untrusted code.
3. No actor runtime, channels, async continuation lowering, ownership/isolate boundary, or host capability permissions are implemented by this scalar slice.
4. The actual iso-lattes repository and loader API remain unidentified in the current GitHub installation; no end-to-end iso-lattes run is claimed.
5. GitHub Actions for this private repository has failed before any runner steps; maintain draft PR status pending an authorized private runner or equivalent reviewed evidence.
6. The `declaredCompilerSha` is caller-supplied metadata, not cryptographic attestation that produced the JS module.

Do not merge/promote on structural checks, fabricated module namespaces, hash-only claims without an independent trusted pin, or workflows with zero executed steps.
