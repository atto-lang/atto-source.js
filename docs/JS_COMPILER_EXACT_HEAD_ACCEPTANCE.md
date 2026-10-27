# JavaScript compiler exact-head acceptance matrix — 2026-10-27

## Source provenance (read-only baseline)

| PR | Purpose | Source-head commit (as audited) | Required focused test |
| --- | --- | --- | --- |
| [#93](https://github.com/ores-truffle-oreslang/oreslang-source.js/pull/93) | `eq/neq/not/and/or` source operators | `d00638c6dafc7d224b45393f35c5ac71e11c8140` | `node --test tests/boolean-word-operators.test.mjs` |
| [#94](https://github.com/ores-truffle-oreslang/oreslang-source.js/pull/94) | Receiver-bound `self` calls | `ebef59ade530d05a7c85b7b4fa72cd52e93fe1e5` | `node --test tests/class-receiver-calls.test.mjs` |
| [#95](https://github.com/ores-truffle-oreslang/oreslang-source.js/pull/95) | Compiler-only hardened lexical scopes | `88137624c933884ce23e9462fc6f263dafbdcae6` | `node --test tests/lexical-const-v0.test.mjs` |
| This stacked branch | Program-v2 typed lexical `const` end-to-end | Pin **the current head** from GitHub immediately before execution | `node --test tests/program-v2-lexical-const.test.mjs` |

Every head SHA must be freshly checked before certifying that run. A successful run
of one PR does **not** certify another PR's head; the stacked branch has #95's
source tree as its base, not #93/#94's unmerged changes.

## Required source-local execution

On an authorized runner checking out the immutable target SHA, capture:

```sh
set -eu
node --version
git rev-parse HEAD
git rev-parse HEAD^{tree}
git status --porcelain
node --test tests/program-v2-lexical-const.test.mjs
npm run test:program-classes
npm run test:class-methods
npm run test:core-bool
npm run test:core-option-result
npm run test:conditionals
npm run test:conditional-adt
npm run test:symbols
npm run test:named-args
npm run check
npm test
npm run test:core-browser
npm run test:browser
```

For #93/#94/#95 execute their corresponding focused test on their own exact
head in addition to `npm run check`, `npm test`, and relevant browser/Worker
smokes. Never treat an older green main-branch run as a PR-head receipt.

## Evidence acceptance criteria

- Runner actually allocated and workflow jobs contain nonempty executed steps.
  A GitHub `conclusion: failure` with `steps: null` or `steps: []`
  is **not** a completed compiler regression run.
- Receipt ties immutable `owner/repo`, commit SHA, tree SHA, workflow run ID,
  runner identity, platform/tool versions, test command, exit status, and
  source/test blob hashes. Reject ambiguous `pending`, `skipped` or
  missing-work claims as passing evidence.
- Node 22 runtime and ESM host/Worker smokes must execute; no fake runtime
  checks can replace them. Review source IR type scope, evaluation order,
  overflow/zero-divisor traps, private receiver authority and error behavior.
- Test exact-source PR order: #93; update/rebase and revalidate #94; #95;
  update/rebase and revalidate this stacked const PR. Resolve conflicts and
  regenerate provenance hashes at every rebase.
- Keep all PRs draft/unmerged until independent reviewer acceptance and all
  applicable real-runner checks pass.

## Private CI mirror policy

`.github/private-ci-approved-repositories.txt` has **zero active destinations**.
Two P0 investigations remain open: platform-conformance [#22]
(https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
and [#77]
(https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77).

Even a private alternate organization's available GitHub Actions minutes do
**not** grant source-transfer authorization. The preferred solution is an
authorized source-local runner. An alternate repo requires an independently
reviewed exact destination owner/name **and numeric ID**, verified private
visibility, reviewed source-snapshot authorization/incident-resume approvals,
and a fail-closed policy gate **before transferring any bytes**.
No public carrier, token-free mirror, temporary branch, or deleted ref is an
exception. Do not mirror a private source tree while these gates are absent.

## Verification already available, but non-certifying

A JavaScript in-memory harness executing the exact fetched compiler/IR files
ran seven `tests/program-v2-lexical-const.test.mjs` cases and passed seven.
The harness substitutes a UTF-8 length encoder and evaluates generated ESM
without Node's module loader; it is **not Node 22 CLI, full repository tests,
or GitHub Actions execution**. Previously PR #95's 10 isolated local tests
passed on Node 22.16.0, also without exact-source runner receipt.
