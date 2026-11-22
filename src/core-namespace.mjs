// Closed, source-only namespace profile for the experimental JS Atto backend.
// The caller supplies exact .atto bytes; no ambient root or module resolver.
import {compileToProgramIRV2,compileProgramIRV2} from './program-v2.mjs';

const CORE_STEMS = new Set(['slice','iter','cmp']);
const MAX_CORE_BYTES = 64 * 1024;

export class CoreNamespaceError extends Error {
  constructor(message) {
    super('error: Atto core namespace: '+message);
    this.name='CoreNamespaceError';
  }
}

/** Compile a single, explicit, backend-owned file-scoped .atto namespace. */
export function compileCoreNamespace({source, expectedNamespace}={}) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_CORE_BYTES)
    throw new CoreNamespaceError('source must be an Atto source string within 64 KiB');
  if (!CORE_STEMS.has(expectedNamespace))
    throw new CoreNamespaceError('only slice/iter/cmp scalar core namespaces are admitted');
  const ir=compileToProgramIRV2(source);
  if (ir.sourceNamespace !== expectedNamespace ||
      ir.modules.length !== 0 ||
      (ir.classes?.length ?? 0) !== 0 ||
      (ir.generators?.length ?? 0) !== 0 ||
      (ir.fileExports?.length ?? 0) !== 0 ||
      ir.functions.length === 0 ||
      !ir.functions.some(fn=>fn.pub) ||
      ir.functions.some(fn=>fn.kind!=='fnc' || fn.module!==null))
    throw new CoreNamespaceError('exact flat public namespace functions are required');
  // All reachable expression effects are checked by program-v2's typed
  // compiler. This is not a runtime actor import or a lifetime-safe Slice.
  return compileProgramIRV2(ir);
}
