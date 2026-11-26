# Counted select host cursor
This is a trusted JS single-isolate host-only runtime slice, not source
compiler or scheduler support. It uses the existing SelectArbiter and
SelectableI64Channel/Future for every commit. The serialized host owner
explicitly begins and pumps one round; readiness only marks the round
dirty and never runs guest code. No implicit per-event task, actor lane,
cross-worker memory, callback execution or typed array lowering is claimed.
Fair/first order, bounded count, Future alias retirement, EOF retirement,
loser revocation, cancellation and no partial success are covered. Unlike
Java, this host lane polls readiness, not a production scheduler; the
terminal channel supports graceful EOF only. RANDOM and typed error close
are not implemented by this slice. Tenant aggregate quota is still needed.
