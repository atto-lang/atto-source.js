# Java ↔ JavaScript parity integration gate — 2026-10-18

**Status: DRAFT / NOT CERTIFIED.** This is a source-repository integration
checkpoint, **not** proof that Java/GraalVM or LLVM code has been executed.

## Reconciliation and lineage

* JS PR #19 (head `2574fad41d3c62d0fbdd795a9d8f46e4e8ce83a9`)
  pins the Java v1.1 semantic fixture inventory and independently reconstructed
  19-file suite SHA-256, with actual Node guest numeric probes.
* JS PR #21 (head `42e6ca793e42a07f7fe1cb6b1c1fe9137cb9b35e`)
  adds strict contradiction rejection for successful Java/JS observation records.
* JS PR #22 (head `67467cac73e291e35056b6872948165aaf2803e5`)
  starts from #19 and incorporates those same contradictory-observation
  invariants **plus** bounded parsed-JSON ingress, commit/tree pairing,
  and Node version shape checks.
* This branch descends from #22; its integration regression test expressly
  exercises #21's acceptance obligations against #22's implementation.
  Do **not** cherry-pick #21's older comparator implementation on top of #22:
  its duplicated field-level checks and different error wording can mask
  or regress the later, stronger admission layer.

`compareJavaAndJsJsonReports` accepts at most 64 KiB JS and 256 KiB Java
JSON; the `compareJavaAndJsReports` live-object interface remains a
**trusted in-process API only**. When JS checkout metadata is present, all six receipt fields (commit, tree, Node runtime, fixture count, and the two explicitly false attestation flags) are required together, and the declared Node version must be 22 or newer. Missing fields are rejected, but self-reported fields are never authenticated. Neither validates GitHub signatures, source
checkout authenticity, executable digests, Java runner allocation, or a
Java ↔ JS parity claim.

## Numeric semantics: blocking issue

The Java reference has historic unmarked `long` wraparound behavior,
whereas the experimental JS Program IR advertises
`signed-i64-checked-provisional` and raises on overflow.

**Proposed language-level rule for review:** checked signed i64 in all
portable guest integer arithmetic; no intermediate wrap or silent narrowing.
A directly signed `-9223372036854775808` literal is legal; the unsigned
positive magnitude `9223372036854775808` is not. Negating an existing
`INT64_MIN` value, adding/subtracting/multiplying outside the range, and
overflowing an intermediate expression are errors. The remainder of
`INT64_MIN % -1` is zero. Remainder by zero errors. Java's existing
`int / int` floating promotion **must not** be silently replaced by
truncating integer division: its typing is a separate language decision.

Until the normative contract is approved and the real Java/LLVM runtime is
changed or configured consistently, the checked-versus-wrapping vectors
are **known discrepancies**, not allowed skips or passing parity cases.
Do not change a wire tag to pretend these semantics agree.

## CI and source-transfer policy

1. Run source-repository Node 22 tests and record exact PR head, Git tree,
   Node version, test output, workflow run/job IDs and executed steps.
2. Before copying **any** private code into a different organization,
   require security-owner and maintainer approvals for immutable destination
   repo ID *and* exact source snapshot, stored in a protected policy.
   Recheck destination identity, visibility, permissions, and policy at
   transfer time. Java PR #1450 is explicitly a proposal, not approval.
3. The incident holds in
   `oreslang-platform-conformance#22` and `#77` must be honored;
   a private carrier and green Actions job do not retroactively
   authorize a private source export.
4. Build and execute the **real** GraalVM/JDK25 Java compiler and the **real**
   Node22 JS compiler against the exact same pinned fixture bytes. Verify
   every branch-tree/checkout/build identity independently. Never substitute
   a hand-authored Java JSON or a Node-only oracle for actual Java execution.
5. Compare exact observed values, failure category **and phase**,
   diagnostics, crash/timeout signals, logs and process exit status.
   Reject missing, pending and unsupported results rather than counting
   them as passing.
6. Extend the same gate to LLVM only after Java↔JS is fully observed.
   LLVM must compile and execute every supported fixture independently.
7. Merge only after green **executed** CI, resolved overflow policy,
   integration review and security approval; never use a zero-step failed
   Actions job to infer a compiler-test failure or available Actions quota.

This branch performs **no cross-organization source copy or CI dispatch**.
