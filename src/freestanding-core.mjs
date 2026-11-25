// Host-neutral freestanding entrypoint for the verified pure integer core subset.
// Importing this module must never load Node, OS, filesystem or Worker adapters.
import {compileToProgramIRV2,compileProgramIRV2} from './program-v2.mjs';
import {isProtectedPreludeIdentity} from './automatic-prelude.mjs';

export class FreestandingCoreError extends Error {
  constructor(message) {
    super('error: freestanding core: '+message);
    this.name='FreestandingCoreError';
  }
}

export function compileFreestandingCore(source) {
  const ir=compileToProgramIRV2(source);
  // Guard the same compiler-owned ADT/collection names as Java and Rust.
  // This does not grant any new allocation, borrowing or generic lowering.
  if (ir.functions.some(f => isProtectedPreludeIdentity(f.name))) {
    throw new FreestandingCoreError('E_PRELUDE_SPOOF: source function cannot replace compiler-owned prelude identity');
  }
  // A namespace is a file-level identity, not a runtime module. Core libraries
  // may therefore export functions directly from `namespace core;` without
  // manufacturing a `core` object. Keep legacy `define module core` working.
  const moduleCore = ir.sourceNamespace === null &&
    ir.modules.length === 1 && ir.modules[0] === 'core';
  const namespaceCore = ir.sourceNamespace === 'core' && ir.modules.length === 0;
  if ((!moduleCore && !namespaceCore) || !ir.functions.length ||
      ir.functions.some(f => f.kind !== 'fnc' ||
        f.module !== (moduleCore ? 'core' : null)) ||
      (ir.classes?.length ?? 0) !== 0 || (ir.generators?.length ?? 0) !== 0)
    throw new FreestandingCoreError(
      'requires one core module or namespace core with source-only functions');
  // The validated program-v2 dialect has no imports, host access, FFI,
  // allocations, clocks, networking, OS handles, dynamic loaders or reflection.
  // This is a deliberately narrow *source-effect* admission proof, not a
  // general Oreslang core tier classifier or a JS no-GC guarantee.
  return compileProgramIRV2(ir);
}

export function checkFreestandingCore(source) {
  compileFreestandingCore(source);
  return true;
}

