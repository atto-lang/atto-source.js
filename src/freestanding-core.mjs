// Host-neutral freestanding entrypoint for the verified pure integer core subset.
// Importing this module must never load Node, OS, filesystem or Worker adapters.
import {compileToProgramIRV2,compileProgramIRV2} from './program-v2.mjs';

export class FreestandingCoreError extends Error {
  constructor(message) {
    super('error: freestanding core: '+message);
    this.name='FreestandingCoreError';
  }
}

export function compileFreestandingCore(source) {
  const ir=compileToProgramIRV2(source);
  if(ir.sourceNamespace!==null || ir.modules.length!==1 || ir.modules[0]!=='core' ||
     !ir.functions.length || ir.functions.some(f=>f.module!=='core'||f.kind!=='fnc'))
    throw new FreestandingCoreError('requires one core module with pure integer functions only');
  // The validated program-v2 dialect has no imports, host access, FFI,
  // allocations, clocks, networking, OS handles, dynamic loaders or reflection.
  // This is a deliberately narrow *source-effect* admission proof, not a
  // general Oreslang core tier classifier or a JS no-GC guarantee.
  return compileProgramIRV2(ir);
}

// Additive closed-world parser for canonical file namespace Atto Core math.
// Callers provide explicitly trusted source bytes. 'use namespace' is NOT a
// package import grant, a filesystem path, or a dynamic JS runtime global.
export function compileOwnedCoreMath(source) {
  const ir=compileToProgramIRV2(source);
  if(ir.sourceNamespace!=='atto.core.math' || ir.modules.length!==0 ||
     !ir.functions.length || !ir.functions.some(f=>f.pub) ||
     ir.functions.some(f=>f.module!==null||f.kind!=='fnc') ||
     (ir.classes?.length??0) || (ir.generators?.length??0) ||
     (ir.fileExports?.length??0))
    throw new FreestandingCoreError('math requires only public top-level functions in use namespace atto.core.math');
  // Internal checked-IR export adapter: the caller-verified lexical namespace
  // is represented as the existing frozen 'math' ESM API for compatibility.
  // Both pre- and post-adaptation IR go through the production validator.
  const adapted={...ir,sourceNamespace:null,modules:['math'],
    functions:ir.functions.map(f=>({...f,module:'math'}))};
  return compileProgramIRV2(adapted);
}

export function checkFreestandingCore(source) {
  compileFreestandingCore(source);
  return true;
}

