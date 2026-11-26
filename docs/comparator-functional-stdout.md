# Explicit capability comparator pipeline slice

`node bin/atto-jsc.mjs --functional-source --allow-stdio input.atto --out=/absolute/guest.mjs`

The independent functional compiler accepts bounded main-only `stdio.println(int)` after immutable locals and before explicit return. A generated ESM guest requires an explicit host callback `main(print_i64)` to execute a stdout-effectful function. No ambient console/process import, no implicit permission and no general I/O effect support. Pure entrypoints keep `main()`. Calls to effectful main are denied; invalid arity/types, unknown values, post-output locals and excess output sites fail closed. Visible Unicode prose in comments is accepted while controls, bidi and non-ASCII program tokens remain denied. The unchanged site fixture is Git blob a29743b5ca5c415fd5896186cdeb88e2eb406dcf; expected stdout 121 newline and i64 return 121. This is generated JS execution only, not worker isolation, native AOT or full compiler parity.
