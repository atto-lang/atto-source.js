# JS backend next steps

1. Register the JavaScript backend in the existing oreslang-platform-conformance manifest and validator; preserve its fail-closed, real-binary evidence requirement.
2. Pin a reviewed target-profiles commit for browser and edge-js rather than using floating main. Separate allowed host capabilities from runtime enforcement.
3. Reconcile signed integer width, arithmetic overflow and integer division against Java. The current signed i64 wraparound behavior is provisional.
4. Replace the restricted standalone parser with shared frontend/IR contracts, adding tests for strings, structs, arrays, maps and closures one vertical slice at a time.
5. Define actor and mailbox semantics with ownership/borrow/transport boundaries and async continuation lowering; never emulate isolates with ordinary JS objects.
6. Add a pinned, trusted ESM packaging adapter for iso-lattes after locating its repository and confirming permission/host loading interfaces.
7. Expand generated code runtime tests and exact-source CI receipts before marking browser/edge-js target support ready.
