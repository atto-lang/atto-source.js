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
