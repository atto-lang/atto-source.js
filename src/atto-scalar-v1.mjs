/**
 * Explicit experimental AttoLang scalar compatibility front door.
 *
 * This is deliberately separate from legacy Oreslang scalar-v1 (which wraps
 * i64) and program-v2's broader provisional Oreslang syntax (which admits %).
 * It does not change the shared program-v2 IR or certify Java/LLVM execution.
 */
import {compileToProgramIRV2,compileProgramIRV2} from './program-v2.mjs';

export class AttoScalarCompileError extends Error {
  constructor(operator, offset) {
    super('ATTO_SCALAR_REMOVED_OPERATOR: ' + operator +
      ' is not an AttoLang scalar operator (source offset ' + offset + ')');
    this.name = 'AttoScalarCompileError';
    this.code = 'ATTO_SCALAR_REMOVED_OPERATOR';
  }
}

// Reject lexical operators rather than regex-matching raw source: annotations,
// comments, nested comments and quoted symbol names are not executable code.
// The underlying program-v2 lexer/type checker remains authoritative for all
// other syntax and rejects unsupported features without generating JS.
function rejectRemovedOperators(source) {
  if (typeof source !== 'string' || source.length > 262144)
    throw new TypeError('AttoLang scalar source must be a bounded string');
  let quoted = null, blockDepth = 0, lineComment = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i], next = source[i+1];
    if (lineComment) {
      if (ch === '\n' || ch === '\r') lineComment = false;
      continue;
    }
    if (blockDepth) {
      if (ch === '/' && next === '*') {blockDepth++; i++; continue;}
      if (ch === '*' && next === '/') {blockDepth--; i++; continue;}
      continue;
    }
    if (quoted !== null) {
      if (ch === '\\' && i+1 < source.length) {i++;continue;}
      if (ch === quoted) quoted = null;
      continue;
    }
    if (ch === '/' && next === '/') {lineComment = true;i++;continue;}
    if (ch === '/' && next === '*') {blockDepth = 1;i++;continue;}
    if (ch === '"' || ch === "'") {quoted = ch;continue;}
    if (ch === '%' || ch === '^') {
      const operator = ch === '^' && next === '^' ? '^^' : ch;
      throw new AttoScalarCompileError(operator,i);
    }
  }
}

export function compileToAttoScalarIRV1(source) {
  rejectRemovedOperators(source);
  return compileToProgramIRV2(source);
}
export function compileAttoScalarV1(source) {
  return compileProgramIRV2(compileToAttoScalarIRV1(source));
}
export function checkAttoScalarV1(source) {
  compileAttoScalarV1(source);
  return true;
}
