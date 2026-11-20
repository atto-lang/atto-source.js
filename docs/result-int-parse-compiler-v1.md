# JS Worker checked Result<int,Error> source-compiled subset v1

A real Atto source frontend now recognizes the narrow parse_id example:
one function of type string -> Result<int,Error> using int.parse(...)?
and one main returning a match on Ok(value)/Err(). It emits static JS Worker
code from a fully parsed and validated AST; arbitrary source text is NEVER
interpolated into the generated module. The source string literal is quoted
using JSON.stringify. Results are frozen tagged records. Invalid decimal
input returns a newly allocated immutable Error; '?' propagates the exact
same Err record. No optional JS exception is caught as a source Err.

Bounded ASCII signed-i64 decimal parsing uses BigInt for precise overflow,
with 1..1024 UTF-8 bytes; malformed and out-of-range return Err. Each
create_tenant call creates its own single-use main closure; tenant state
is not shared between guests in this subset.

This is a **TRUSTED JS WORKER PROFILE**, not an untrusted multi-tenant
same-process isolation proof, not a generic Result/Option compiler,
and not trap/throw/raise/panic/defer/recover parity. Source syntax outside
the proven grammar fails closed. Spec candidate atto-spec #124, shared
conformance #68, tracker #20. Tests transpile real Atto source into JS
module code and execute it; only exact-head successful CI can certify
this new candidate. No public /play binary or release pin is changed.
