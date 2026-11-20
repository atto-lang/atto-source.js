# JS source-local parser integration rehearsal

This branch integrates three separate draft heads only for conflict testing:

- Task PR #47 671aa7342c36d24375cc2fa867ebd4f3ed6495ef
- Mutex PR #43 fcb174d7926133d156d4134c78ce05b31a058801
- Operators PR #46 7bcc94f2e5093cc66de866fcfbf5cb3dc9223b20

The reconciled lexer separates closing angle brackets from I/O `>>`
within nested generic type contexts. This fixes the mismatch uncovered by
running all five existing targeted test files together.

This is NOT a merge, a full Node 22 test run, a production security admission,
or independently verified conformance. Private source stays exclusively
inside the original private GitHub repository.

Operator conformance regression tests refreshed from draft PR #46 exact
head `7de00dbff1ac6ff8fab0994e2ff745f77ae38042`, including generic-close/channel-read disambiguation.
