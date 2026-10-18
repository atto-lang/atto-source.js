/**
 * Fail-closed program-v2 audit gate for the experimental frontend.
 *
 * This adapter is temporary until syntax parsing and symbol resolution
 * migrate to the common typed Program IR. It does not execute guest code.
 */
import {compileProgramV2 as compileExperimental} from './program-v2.mjs';

function auditedTokens(source) {
  if (typeof source !== 'string') throw new TypeError('Oreslang source must be text');
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) {i++; continue;}
    if (source.startsWith('//',i)) {
      i += 2;
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (source.startsWith('/*',i)) {
      i += 2; let nesting = 1;
      while (i < source.length && nesting) {
        if (source.startsWith('/*',i)) {nesting++;i+=2;}
        else if (source.startsWith('*/',i)) {nesting--;i+=2;}
        else i++;
      }
      if (nesting) throw Error('error: program v2: unterminated comment');
      continue;
    }
    if (/[A-Za-z_]/.test(source[i])) {
      const begin=i++;
      while(i<source.length && /[A-Za-z0-9_]/.test(source[i])) i++;
      tokens.push(source.slice(begin,i));
    } else {tokens.push(source[i++]);}
    if(tokens.length>30000)throw Error('error: program v2: token budget exceeded');
  }
  return tokens;
}

export function compileProgramV2(source) {
  // The canonical compiler performs full parsing/validation before codegen.
  // This additional conservative check prevents known semantic escapes until
  // public routine kinds and root/module identity are resolved in shared IR.
  const tokens=auditedTokens(source);
  for(let i=0;i+1<tokens.length;i++){
    if(tokens[i]==='pub' && tokens[i+1]==='routine')
      throw Error('error: program v2: public routine is direct-call-only and cannot be exported as ESM');
    if(tokens[i]==='module' && tokens[i+1]==='root' && i>0 && tokens[i-1]==='define')
      throw Error('error: program v2: module named root blocked until distinct symbol identities are supported');
  }
  return compileExperimental(source);
}
export function checkProgramV2(source) {compileProgramV2(source); return true;}
