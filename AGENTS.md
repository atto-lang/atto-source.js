# Repository AI agent instructions

<!-- org-merge-review-policy:begin -->
> **Agent/PR governance:** Read [atto-lang's canonical AGENTS.md](https://github.com/atto-lang/.github/blob/main/AGENTS.md). **Drafts:** at 72h of the CURRENT Draft cycle (creation if opened Draft, otherwise latest genuine Ready→Draft), automatically mark Ready if material CI passes on the exact current head and no `keep-as-draft`, `not-ready`, or legacy `keep-draft` label exists; recheck labels and CI before promotion. **The Ready review clock starts at zero upon promotion.** Ready age <72h: Codex/ChatGPT + Claude/Opus + `ORESoftware` + `the1mills` approvals. Ready age 72–240h: one verified independent approval, green CI, no conflicts, and a **mandatory competing/overlapping PR audit**; update current/competing PRs before merging when needed. Ready age ≥240h: fresh post-boundary reviews from all four. A genuine return to Draft ends/resets the Ready cycle. Respect GitHub protections, never manipulate draft state to game age, and inspect [legacy Oreslang counterpart PRs](https://github.com/ores-truffle-oreslang/.github/blob/main/governance/atto-migration-map.json) before duplicating features.
<!-- org-merge-review-policy:end -->

## Backend CI evidence

A workflow that fails before runner admission, including jobs with `steps=[]` or null steps, is `NOT_EXECUTED`, not a compiler or guest test result. Recover on an authorized runner and verify the exact source commit/tree and executed test results. A host-only JavaScript model or source transpilation is not proof of native guest AOT, zero process GC, or cross-backend parity.
