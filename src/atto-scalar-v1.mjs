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

export class AttoScalarUnsupportedFeatureError extends Error {
  constructor(feature) {
    super('ATTO_SCALAR_UNSUPPORTED_FEATURE: ' + feature);
    this.name = 'AttoScalarUnsupportedFeatureError';
    this.code = 'ATTO_SCALAR_UNSUPPORTED_FEATURE';
  }
}

// Acceptance in the wider Oreslang program-v2 is not acceptance in the
// canonical AttoLang scalar-core suite. Retain only typed i64 pure calls and
// checked arithmetic; do not silently certify bool, modules, classes,
// conditional/lazy branches, Symbols, generators, ADTs, or match semantics.
function requirePortableScalarSubset(ir) {
  const unsupported = feature => {throw new AttoScalarUnsupportedFeatureError(feature);};
  if (ir.sourceNamespace !== null || ir.modules.length ||
      (ir.classes ?? []).length || (ir.generators ?? []).length)
    unsupported('namespace, module, class or generator declarations');
  const work=[];
  for (const fn of ir.functions) {
    if(fn.kind !== 'fnc' || fn.module !== null ||
       fn.paramTypes !== undefined || fn.returnType !== undefined)
      unsupported('only pure int -> int fnc declarations are admitted');
    work.push(fn.body);
  }
  while (work.length) {
    const expr=work.pop();
    switch(expr.kind) {
      case 'int': case 'param': break;
      case 'neg': work.push(expr.inner); break;
      case 'binary':
        if(!['+','-','*'].includes(expr.op))
          unsupported('integer operator ' + expr.op);
        work.push(expr.left,expr.right);
        break;
      case 'call': work.push(...expr.args); break;
      default: unsupported('expression kind ' + expr.kind);
    }
  }
  return ir;
}

export function compileToAttoScalarIRV1(source) {
  rejectRemovedOperators(source);
  return requirePortableScalarSubset(compileToProgramIRV2(source));
}
export function compileAttoScalarV1(source) {
  return compileProgramIRV2(compileToAttoScalarIRV1(source));
}
export function checkAttoScalarV1(source) {
  compileAttoScalarV1(source);
  return true;
}
