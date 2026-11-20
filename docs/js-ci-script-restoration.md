# JS workflow named-command repair

The protected CI workflow invokes eleven npm scripts missing from the previous
package manifest. This proposal restores every command with explicit, existing
Node source tests, preserving the full `npm test` run and all existing workflow
steps. No workflow YAML is altered, and no gate is skipped.

`check` validates JavaScript syntax in src, runtime, bin, scripts and tests
with a bounded, shell-free Node child process; the separate contract test in
`npm test` rejects missing workflow scripts, silently deleted required
workflow commands, and nonexistent selected test files.

The source Git tree was checked for each named target; whole-suite Node 22,
actual browser Worker, and stepful GitHub Actions remain NOT_EXECUTED.
Keep DRAFT pending exact-head execution, protected workflow review, and
independent admission. No private source was copied out of the repository.
