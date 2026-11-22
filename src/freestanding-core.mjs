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

// Production parser + typed-IR + checked-ESM path for the *pure* backend-owned
// core/cell policy. This compiles integer/bool admission predicates, NOT a
// Cell<T>, RefCell<T>, loan token, lock or mutable memory capability. The
// caller supplies trusted bytes; this function grants no import authority.
// Require the complete reviewed interface: a spoofed or partially linked
// module must not acquire a trusted-looking "cell" export.
export function compileOwnedCoreCellPolicy(source) {
  const ir=compileToProgramIRV2(source);
  const signatures=new Map([
    ['can_borrow_read','bool'],['can_borrow_write','bool'],
    ['readers_after_acquire','int'],['readers_after_release','int'],
    ['valid_loan_state','bool'],['can_owner_read','bool'],
    ['can_owner_write','bool'],['can_move_owner','bool'],
    ['can_suspend_unpinned','bool']
  ]);
  if(ir.sourceNamespace!==null || ir.modules.length!==1 ||
     ir.modules[0]!=='cell' || ir.functions.length!==signatures.size ||
     (ir.classes?.length??0)!==0 || (ir.generators?.length??0)!==0 ||
     (ir.fileExports?.length??0)!==0)
    throw new FreestandingCoreError('cell policy requires one complete pure compiler-owned module');
  const seen=new Set();
  for(const fn of ir.functions) {
    if(!signatures.has(fn.name) || seen.has(fn.name) ||
       fn.module!=='cell' || fn.kind!=='fnc' || !fn.pub ||
       (fn.returnType??'int')!==signatures.get(fn.name) ||
       fn.params.length!==2 ||
       fn.paramTypes?.[0]!=='int' || fn.paramTypes?.[1]!=='bool')
      throw new FreestandingCoreError('cell policy declaration/signature mismatch');
    seen.add(fn.name);
  }
  // The full ESM generator receives only the validated, resolved source IR.
  // Its output is pure arithmetic/boolean code, never host-resource imports.
  return compileProgramIRV2(ir);
}

export function checkFreestandingCore(source) {
  compileFreestandingCore(source);
  return true;
}

