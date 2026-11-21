// Fail-closed JS/Worker tenant admission: Node Worker and browser Worker
// are in-process language execution domains, never OS sandboxes. This guard
// does NOT implement a verified TenantVM or secure tenant restart.
// Worker hosts receive spawn options alongside isolation options. Copy only the
// isolation descriptors, so accessors still fail closed and are never invoked.
export function tenantIsolationOptionsOf(options) {
  if(options===null || typeof options!=='object' || Array.isArray(options))return options;
  const selected=Object.create(null);
  for(const key of ['isolation','untrusted']){
    const descriptor=Object.getOwnPropertyDescriptor(options,key);
    if(descriptor)Object.defineProperty(selected,key,descriptor);
  }
  return selected;
}

export function requireSupportedTenantWorkerIsolation(options = {}) {
  if(options===null || typeof options!=='object' || Array.isArray(options))
    throw new TypeError('tenant isolation options must be a plain object');
  const proto=Object.getPrototypeOf(options);
  if(proto!==Object.prototype && proto!==null)
    throw new TypeError('tenant isolation options must be plain data');
  const keys=Reflect.ownKeys(options);
  if(keys.some(key=>key!=='isolation' && key!=='untrusted'))
    throw new TypeError('unknown tenant isolation option');
  const own=(key,fallback)=>{
    const descriptor=Object.getOwnPropertyDescriptor(options,key);
    if(!descriptor)return fallback;
    if(!Object.hasOwn(descriptor,'value') || !descriptor.enumerable)
      throw new TypeError('tenant isolation options must be own data');
    return descriptor.value;
  };
  const isolation=own('isolation','trusted-worker');
  const untrusted=own('untrusted',false);
  if (typeof untrusted !== 'boolean')
    throw new TypeError('untrusted must be a boolean');
  if (untrusted)
    throw new Error('untrusted tenant requires a separately verified OS sandbox / TenantVM execution boundary');
  if (isolation === 'trusted-worker') return;
  if (typeof isolation !== 'string')
    throw new TypeError('tenant isolation mode must be a string');
  if (['tenant-vm', 'TenantVM', 'wasmtime-store', 'vm-isolate', 'sandboxed-process', 'untrusted'].includes(isolation))
    throw new Error('requested tenant isolation boundary is not implemented by JS Workers');
  throw new TypeError('unknown tenant isolation mode');
}
