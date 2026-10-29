// Fail-closed JS/Worker tenant admission: Node Worker and browser Worker
// are in-process language execution domains, never OS sandboxes. This guard
// does NOT implement per-tenant persistent IsolateVM or secure worker restart.
export function requireSupportedTenantWorkerIsolation({
  isolation = 'trusted-worker', untrusted = false
} = {}) {
  if (typeof untrusted !== 'boolean')
    throw new TypeError('untrusted must be a boolean');
  if (untrusted)
    throw new Error('untrusted tenant requires a separately verified OS sandbox');
  if (isolation === 'trusted-worker') return;
  if (typeof isolation !== 'string')
    throw new TypeError('tenant isolation mode must be a string');
  if (['wasmtime-store', 'vm-isolate', 'sandboxed-process', 'untrusted'].includes(isolation))
    throw new Error('requested tenant isolation boundary is not implemented by JS Workers');
  throw new TypeError('unknown tenant isolation mode');
}
