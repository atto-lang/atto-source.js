# JS shared-frontend integration candidate — 2026-11-20

**Purpose:** execute *together* the unique trusted-worker compiler features from five separately open Draft PRs, not to supersede their reviews or claim cross-backend parity.

| Input draft | Exact origin commit | Integrated behavior |
| --- | --- | --- |
| [#31](https://github.com/atto-lang/atto-source.js/pull/31) | `7ae1baaa591c7a4fbd6b457c49870b91ce0c14f1` | Typed ActorMail intake, bool mail, declared sends/receives and safe route data |
| [#42](https://github.com/atto-lang/atto-source.js/pull/42) | `d3e1a0df2406f17ddbb90629eba445bfb95cae8c` | Sealed actor-state counter compiler; all 13 shared fixtures |
| [#38](https://github.com/atto-lang/atto-source.js/pull/38) | `c8ea7e09f1195c6b0060e628760d367ada88a713` | Restricted Result<int,Error> parse compiler, source fixtures and regression suites |
| [#43](https://github.com/atto-lang/atto-source.js/pull/43) | `fcb174d7926133d156d4134c78ce05b31a058801` | Mutex<T> nominal constructor diagnostics |
| [#46](https://github.com/atto-lang/atto-source.js/pull/46) | `7de00dbff1ac6ff8fab0994e2ff745f77ae38042` | `^ expression;` return; int `^^`; `<<<`/`>>>` shifts; I/O `<<`/`>>` deny; source control checks |

## Conflict fixes identified by running the combination

1. **Lambda arrows:** Result matching requires one `->` token, but #42's sealed-state compiler uses separate `-` and `>`. Maximal-munch source tokenization remains shared; the state-only adapter splits `->` immediately before the dedicated sealed-state parser, after raw-source control and UTF-16 validation. Do not change Result token boundaries globally.
2. **Caret return:** statement-position `^ expression;` normalizes to `return expression;` only at a statement boundary (`{`, `;`, `}`) and only with an expression; infix `a ^ b`, bare `^;`, and embedded-expression carets remain rejected. Result and sealed-state programs now accept this alias as well as the scalar and typed actor forms.
3. **Generic closer/I/O:** nested `Mutex<Option<int>>` closers must not be interpreted as typed channel-read `>>`. Unsupported `<<`/`>>` remain errors, not shifts, and `new Mutex<T>` still fails `E_LOCK_UNSUPPORTED` without scheduler/lease lowering.
4. **Dispatch partitioning:** continuous actor `pipe/rpipe` denied; Mutex constructor admission checked; sealed state routed before ordinary actor; Result/match parser before integer scalar; only the narrow supported subgrammars can emit generated JS.

## Test evidence and required gates

**Committed tests:** `tests/shared-frontend-integration.test.mjs` plus the complete existing suites from each PR. `npm test` runs all `tests/*.test.mjs`. Exact-head `.github/workflows/js-frontends-integration.yml` checks the Git source revision and tree, regular-file modes, Node 22 syntax, focused generated guest execution, and the full suite.

**Available local preflight (not Node/GHA):** V8 isolate executing the exact fetched integration compiler and compiled generated JavaScript passed Result, scalar and actor-state positive/negative samples; all 10 actor-state negative contract fixtures rejected and all 3 guarded-state positive fixtures were recognized. A first combined preflight found a real state-arrow bug, fixed on the branch. These checks do **not** certify the committed integration test file or complete Node suite.

**Still NOT_EXECUTED:** full-branch Node 22 `npm test`, GitHub-hosted stepful CI, true TenantVM sandbox/intra-process isolation, source-tree SHA-verified combined checkout, and independent security review. Keep this integration branch and PR Draft, do not merge source feature PRs, and do not export to another private organization without the independently approved `.github/private-ci-approved-repositories.txt` entry.

Known design follow-up: `normalize_generic_closers` is a bounded heuristic for a fixed set of nominal generic names, **not** a complete type parser for arbitrary user-defined nested generics. Conformance and formatter alignment are separate from this trusted JS preview, and Boolean `^^` conflict in `atto-spec#6` remains subject to explicit spec review.

## Post-integration security audit — November 20, 2026

**Current pinned compiler bytes (Git blobs):**
- `src/transpile-worker.mjs` — `f0b4b638bad65ce4608bfe04f9f3b0738ceb5858`.
- `src/result-int-parse-compiler.mjs` — `01a6fd4e2830008c0a79bd1b7e4287c234c97cce`.
- `src/actor-state-counter.mjs` — `b4f2ed782e205810dbaeef83025ea5db52dad26c`.
- `tests/shared-frontend-integration.test.mjs` — `0ea81be64459568b539a5efe538993a3ad157879`.
- Private transfer policy `.github/private-ci-approved-repositories.txt` — `e861197f825e7f4c3587dd377d099f3eb3c862fe`, exactly copied from protected `main`.

**Additional security fixes since candidate creation:**
1. The old integration baseline was missing `.github/private-ci-approved-repositories.txt` although protected `main` has an explicit empty carrier allowlist. Restored the **exact main Git blob** and pinned its SHA in the integration workflow. This does not grant source export.
2. On generic close, excess `>>` previously disappeared into split `>` tokens. Now the normalizer consumes only the open generic depth and preserves any remaining `>>` for `E_IO_UNSUPPORTED`. Added source-level regression.
3. After raw-token admission, generic closer expansion must still satisfy the 4,096-token cap. Added expanded-generic test.
4. All **five supported trusted-JS guest profiles** now check nonempty, trimmed, bounded tenant ID strings and positive safe generation epochs at most 2,147,483,647. Scalar, integer actor and Boolean actor previously accepted `create_tenant({})`; Result accepted whitespace-padded IDs; sealed state admitted oversized epochs. Negative and valid-boundary regression tests are committed. **This checks the shape of a binding only. Host-side TenantVM identity authentication, capability ceilings and revocation remain separate required controls.**
5. Added explicit source-byte, raw-token and AST-nesting budget tests.

**Actual preflight evidence (NOT CI):** V8 isolate executing compiler-generated JS on current fetched blobs: 384/384 deterministic i64 bitwise property checks; 50/50 tenant-binding admissions/rejections; 10/10 canonical Result guest cases; 13/13 guarded-state positive+negative cases. The *actual checked-in integration-test callbacks*, adapted in memory for Node-specific imports/files and data-URI loading, passed 11/11. Independently computed Git blob SHA-1 matched GitHub for 7/7 audited source/test/workflow/policy files (before the subsequent tenant changes, which have new recorded SHAs above).

**Still blocked:** no authoritative complete exact-tree Node 22 `npm test` execution, no stepful hosted CI evidence for the current PR head, no independently approved private carrier and no attested TenantVM isolation. Do not export private source to another organization solely because a hosted-runner canary becomes available. No branch promotion or merge until the required approval, full CI and independent review.

## November 20: bounded Result-aware trap incorporation

Integration PR #71 now carries the nonduplicative extension from Result PR #38:
`trap` on statically known `int.parse` / `parse_id` operands of type
`Result<int,Error>` is erased to the same guest ESM as the untrapped
expression, preserving the exact original tagged Result/Err identity.
The stricter integration-only `tenant.trim() === tenant` binding requirement
is retained; merging feature branch #38 wholesale would regress that check.

The shared integration suite imports the new successful/Err compiled-guest cases
and negative untyped/nested trap cases. No ordinary source `throw` or host
JavaScript exception is caught, no actor privilege is added, and all other
`trap` effects remain unsupported. The existing Node 22 integration workflow
must execute on the final exact integration SHA, not only on #38's head.
At the time of this update, there is no matching exact-head stepful CI receipt.
