# JS backend protected-branch and executable CI admission

Status: **release-blocking / administrator action required** (2026-10-24).
The code in this document is policy guidance; adding `CODEOWNERS` or
changing a workflow **does not itself activate branch protection**.

## Current independently checked facts

- Private source repository: `ores-truffle-oreslang/oreslang-source.js`,
  numeric repository ID **1423606573**. Default branch `main` at
  `fce498c3984870f03e4b0a07e844f6907a1918ad` when this document was
  authored; refresh the immutable SHA at execution.
- `main` reported `protected: false`. No CODEOWNERS file existed on main.
- GitHub rulesets API returned HTTP 403:
  "Upgrade to GitHub Pro or make this repository public to enable this feature."
  **Do not make private source public to fix CI or protection.**
  Use an appropriate authorized GitHub private-repository plan or supported
  branch-protection control and confirm enforcement against a synthetic PR.
- The source Actions runs on JS PRs #44–#47 repeatedly failed before a
  runner was assigned (`runner_id: 0`, `steps: []`). An Actions run marked
  `failure` with zero executed steps is **NOT_EXECUTED** test evidence.
- A prior private-source cross-organization mirror caused an open security
  incident: `ores-truffle-oreslang/oreslang-platform-conformance#22`.
  Independent resumption approval is absent. No cross-org transfer is
  authorized by this document.
- Verified independent CODEOWNER candidate: `@ORESoftware` (repository
  permission `admin`). The repository-connected account is
  `the1mills`. Admin access is not proof of a completed review.

## Administrator setup (GitHub UI, not an untrusted PR-head workflow)

1. Confirm repository visibility remains private. Resolve any plan/feature
   limitations with an authorized administrator; do not downgrade security.
2. Enable a rule on `main` requiring pull requests, at least one *different*
   approver, CODEOWNER review, stale-review dismissal, and review after the
   latest author push. No force-push or branch delete; restrict bypass
   actors, including administrators, consistent with organization policy.
3. Protect workflow and CODEOWNERS changes themselves. Required checks must
   come from trusted workflows whose definitions cannot be changed by an
   unreviewed PR. Pin third-party Actions to reviewed commit SHAs. Do not
   rely on a mutable arbitrary check of the same name as trusted evidence.
4. Record actual required status-check names/identities only after at least
   one verified runner executes. The repository currently defines workflows:
   `JS compiler bootstrap tests`, `Browser and Node Worker smoke`,
   `Freestanding core Node and browser`, `Integration declaration integrity`.
   Do not infer that a workflow's display name is a GitHub status-check name.
5. Test the effective rule with a **synthetic non-sensitive PR**: attempt a
   direct push, merge without approval, stale approval, failing/missing check,
   and an unauthorized reviewer. All prohibited operations must be denied.
   Record GitHub's observed behavior and a second approver's sign-off.

## CI diagnosis and acceptance

Ask an authorized Actions/billing administrator to check remaining private
minutes, spending limits, enterprise/org/repository Actions policy and hosted
runner availability/labels. The linked GitHub App cannot access these settings.

A temporary checkout-free/no-token/zero-dependency source-free probe was
executed on PR #48 at immutable head `5ef881af9c65cf3baa48de514e61b8c6b3beaccb`:
[workflow run #40129913430](https://github.com/ores-truffle-oreslang/oreslang-source.js/actions/runs/40129913430),
job `120979227465`, `runner_id:0`, `runner_name:""`, `steps:[]`,
`conclusion:failure`. The temporary workflow was **removed** after recording
the evidence; it is not a permanent, merge-required check. This proves
source-free steps could not execute, independently of checkout, package
dependencies or compiler changes. It does not distinguish billing from a
runner or repository-policy problem.

After an administrator changes runner admission settings, rerun one **source-free**
checkout-free smoke job. Do not rerun a long matrix while allocation still
fails. Require nonzero `runner_id`, nonempty executed `steps` and accessible
logs. Then test each immutable reviewed PR
head and final merge tree with Node 22, the complete `npm test`, `npm run check`,
`npm run test:workers`, and real Chromium `npm run test:browser`. For PR #44
and stacked #45 add the corresponding conditional and Option/Result scripts.
Record source commit, Git tree, Node and Chromium versions, test counts,
reviewer, job URLs, and hashes.

## Cross-organization fallback: deny by default

Private source may **not** be copied to a different repository merely because
its GitHub Actions budget appears available or because no PAT is used.
Before reading/transferring a source blob, independently verify ALL of:

- The still-applicable incident #22 resume authorization or completed closure.
- Reviewed protected-main allowlist naming one exact `owner/repo` and the
  immutable **numeric** destination repository ID; source/destination both
  authenticated and `private:true`. No publicly visible carrier.
- Source repository ID `1423606573`, exact approved commit **and Git tree**
  plus reviewed source branch, with policy checked from a trusted, protected
  revision (never from a caller-controlled PR tree).
- Reviewed destination owner/security approval, no secrets/history
  accidentally bundled, and GitHub Actions capacity proved with a source-free
  real executed job.
- Verify each Git tree/blob identity after transfer and again immediately
  before build; bind test evidence to an immutable destination **commit**.
  Re-check destination privacy and approval before **every write** and abort
  on a revocation or changed repository identity.
- Clean up temporary test refs under policy, preserve audit provenance, and
  separately enforce source-branch required checks and independent review.

If any prerequisite is missing, return **NO_TRANSFER**. A successful build
is test evidence, not permission to disclose private source.

## Required sequence

Protect main, establish independently trusted and stepful CI, verify exact
heads for PR #44 then #45, then verify PR #46's real Node/Chromium Worker
execution and PR #47's bounded class tests. Do not merge current drafts based
on V8-only probes, synthetic Workers, or runnerless GitHub failures.

References:
- CI blocker: https://github.com/ores-truffle-oreslang/oreslang-source.js/issues/2
- Worker draft: https://github.com/ores-truffle-oreslang/oreslang-source.js/pull/46
- Private-source incident: https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22
- Mirror identity/approval gate: https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962

## November 2026 status refresh (supersedes only dated facts above)

- Verified 2026-11-17: `main` commit `a1e8c81b3d40e1ccec187a2708a720c263234536`, `protected:false`; required status-check enforcement is off. GitHub App administration endpoints remain inaccessible; a repository administrator must make and validate the rule change.
- Contrary to the historical October 24 observation above, `main` **now has** `.github/CODEOWNERS`, Git blob `9b212c48c67c57816fe55715905abfd0ef606215`. Do not replace it with the obsolete #48 version.
- Source-owned Actions retry: test workflow run `42430206089`, attempt 2 job `134542819781` completed with `failure`, `steps:null`. No Node tests ran and retrying did not repair admission.
- `.github/private-ci-approved-repositories.txt` has **zero active destination approvals**. Security incident `oreslang-platform-conformance#22` is still open, including its independent resume-approval gate. **NO_TRANSFER** until both governance requirements are actually satisfied; private destination status alone is insufficient.
- Five clean mainline integrations are under review as #262 (ESM tests), #263 (scheduler cooperation), #264 (this document), #265 (Worker receipt/ownership hardening) and #266 (generation-fence authentication/closure). They have focused local/identity evidence only; the code PRs require exact-head executable tests and independent approvals before merging.
- Before enabling required checks, first restore one trusted checkout-free CI smoke workflow with an allocated runner and recorded steps, then execute the full required Node 22/Worker/browser matrix, and only then pin the verified check identities. Review of the policy document itself can proceed independently of code execution.
