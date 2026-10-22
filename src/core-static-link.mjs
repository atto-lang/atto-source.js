// Portable compile-time-only core linker for the experimental program-v2
// integer dialect. There are NO runtime imports, filesystem reads, fetches,
// host grants or dynamic loaders in this module. Supply trusted source bytes.
// This is a narrow adapter; the canonical cross-backend module resolver and
// dependency/effect closure are not yet implemented.
import {compileFreestandingCore} from './freestanding-core.mjs';
import {compileToProgramIRV2,compileProgramIRV2} from './program-v2.mjs';

export class CoreLinkError extends Error {
  constructor(message) {
    super('error: core linker: '+message);
    this.name='CoreLinkError';
  }
}

// The directive must be the first non-comment source content. No arbitrary
// path resolution or transitive package imports are admitted in this profile.
// Legacy std/core is a source-only alias, not a host runtime import.
const CORE_DIRECTIVE=/^import[ \t]+module[ \t]+core[ \t]+from[ \t]+"(?:core|std\/core)"[ \t]*;/;
const DIRECTIVE_COUNT=262144;
function leadingTrivia(source) {
  let i=0;
  while(i<source.length){
    if(/\s/.test(source[i])){i++;continue;}
    if(source.startsWith('//',i)){
      const end=source.indexOf('\n',i+2);
      i=end<0?source.length:end+1;
      continue;
    }
    if(source.startsWith('/*',i)){
      i+=2;let depth=1;
      while(i<source.length&&depth>0){
        if(source.startsWith('/*',i)){
          if(++depth>64)throw new CoreLinkError('comment nesting exceeded');
          i+=2;
        }else if(source.startsWith('*/',i)){depth--;i+=2;}
        else i++;
      }
      if(depth)throw new CoreLinkError('unterminated source comment');
      continue;
    }
    break;
  }
  return i;
}
export function compileToCoreLinkedIR(applicationSource,coreSource) {
  if(typeof applicationSource!=='string'||typeof coreSource!=='string')
    throw new CoreLinkError('source inputs must be strings');
  // The standard parser enforces byte budgets, strict declarations, exact
  // signatures, duplicate-module rejection and typed call resolution.
  const offset=leadingTrivia(applicationSource);
  const match=CORE_DIRECTIVE.exec(applicationSource.slice(offset));
  if(!match)throw new CoreLinkError('expected leading import module core from "core";');
  const body=applicationSource.slice(offset+match[0].length);
  if(!body.trim())throw new CoreLinkError('application has no declarations');
  if(applicationSource.length+coreSource.length>DIRECTIVE_COUNT)
    throw new CoreLinkError('combined source exceeds linker size budget');
  // Independently establish that the exact core source is a pure integer-only
  // module, before allowing it into the same compile-time resolution scope.
  // This is source-only effect exclusion, not a signed package identity check.
  compileFreestandingCore(coreSource);
  const linked=coreSource+'\n'+body;
  const ir=compileToProgramIRV2(linked);
  if(ir.modules.filter(m=>m==='core').length!==1 ||
     !ir.functions.some(fn=>fn.module!=='core'))
    throw new CoreLinkError('application must define a noncore callable');
  // The compiler's resolver rejects calls to private members, unresolved
  // identifiers and unadmitted functions. The resulting IR contains no host
  // imports or reflection entrypoints.
  return ir;
}
export function compileCoreLinkedProgram(applicationSource,coreSource) {
  return compileProgramIRV2(compileToCoreLinkedIR(applicationSource,coreSource));
}
export function checkCoreLinkedProgram(applicationSource,coreSource) {
  compileCoreLinkedProgram(applicationSource,coreSource);
  return true;
}
