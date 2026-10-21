/**
 * Backend-independent, source-free structural type proof for Oreslang JS.
 * This is a typed-IR predicate, NOT a host-JS object-shape test or a source parser.
 * An accepting proof cannot restore mutation rights or forge an actor identity.
 */
const MAX_DEPTH = 64;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const SHAPES = new Set(['record', 'struct', 'contract', 'interface', 'trait', 'class']);
const PRIMITIVES = new Set(['int', 'float', 'decimal', 'complex', 'bool', 'string', 'void', 'null']);
const owns = (x, k) => Object.hasOwn(x, k);
function plain(x) {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  if (proto !== null && proto !== Object.prototype) return false;
  for (const k of Reflect.ownKeys(x)) {
    if (typeof k !== 'string' || RESERVED.has(k)) return false;
    const d = Object.getOwnPropertyDescriptor(x, k);
    if (!d || !owns(d, 'value')) return false;
  }
  return true;
}
const name = s => typeof s === 'string' && /^[A-Za-z_][A-Za-z_0-9]{0,127}$/.test(s) && !RESERVED.has(s);
function exact(x, allowed, required=[]) {
  if (!plain(x)) return false;
  const keys=Reflect.ownKeys(x);
  return keys.every(k=>allowed.includes(k)) && required.every(k=>owns(x,k));
}
function arr(v) {
  if (!Array.isArray(v) || v.length > 256 || Object.getPrototypeOf(v) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(v);
  if (keys.length !== v.length + 1) return false;
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) ||
        Number(key) >= v.length) return false;
    const descriptor = Object.getOwnPropertyDescriptor(v, key);
    if (!descriptor || !owns(descriptor, 'value')) return false;
  }
  return true;
}
function typedesc(t) { return typeof t === 'string' ? PRIMITIVES.has(t) : plain(t); }
function fieldMap(shape) {
  if (!plain(shape) || !arr(shape.fields ?? [])) return null;
  const map = new Map();
  for (const f of shape.fields ?? []) {
    if (!exact(f,['name','type','public'],['name','type','public']) ||
        !name(f.name) || !typedesc(f.type) || typeof f.public !== 'boolean' || map.has(f.name)) return null;
    map.set(f.name, f);
  }
  return map;
}
function methodsMap(shape) {
  if (!plain(shape) || !arr(shape.methods ?? [])) return null;
  const map = new Map();
  for (const m of shape.methods ?? []) {
    if (!exact(m,['name','params','generics','result','public','static','abstract','async'],
               ['name','params','result','public']) ||
        !name(m.name) || !arr(m.params) || !arr(m.generics ?? []) ||
        typeof m.public !== 'boolean' ||
        (owns(m,'static') && typeof m.static !== 'boolean') ||
        (owns(m,'abstract') && typeof m.abstract !== 'boolean') ||
        (owns(m,'async') && typeof m.async !== 'boolean') ||
        map.has(m.name + '/' + m.params.length)) return null;
    if (!(m.generics ?? []).every(name) || new Set(m.generics ?? []).size !== (m.generics ?? []).length) return null;
    if (!typedesc(m.result)) return null;
    for (const p of m.params)
      if (!exact(p,['type','mutable'],['type']) || !typedesc(p.type) ||
          (owns(p,'mutable') && typeof p.mutable !== 'boolean')) return null;
    map.set(m.name + '/' + m.params.length, m);
  }
  return map;
}
const primitive = t => typeof t === 'string' ? t : null;
function eqGeneric(a, b, leftBind, rightBind) {
  if (!plain(a) || !plain(b) || a.kind !== 'var' || b.kind !== 'var') return false;
  const ai = leftBind.indexOf(a.name), bi = rightBind.indexOf(b.name);
  return ai >= 0 && ai === bi;
}
function assign(a, b, depth = 0, aBind = [], bBind = []) {
  if (depth > MAX_DEPTH || !typedesc(a) || !typedesc(b)) return false;
  if (primitive(a) || primitive(b)) return typeof a === 'string' && a === b;
  if (a.kind === 'var' || b.kind === 'var') return eqGeneric(a, b, aBind, bBind);
  if (a.kind === 'nominal' || b.kind === 'nominal') {
    if (a.kind !== 'nominal' || b.kind !== 'nominal' || !name(a.name) || !name(b.name)) return false;
    if (!arr(a.args ?? []) || !arr(b.args ?? []) || (a.args ?? []).length !== (b.args ?? []).length) return false;
    // Untrusted inline ancestors cannot certify inheritance; only exact
    // nominal equality is admitted until a sealed compiler hierarchy is wired.
    const nominalProof = a.name === b.name;
    return nominalProof && (a.args ?? []).every((x, i) =>
      assign(x, b.args[i], depth + 1, aBind, bBind) && assign(b.args[i], x, depth + 1, bBind, aBind));
  }
  if (a.kind === 'tuple' || b.kind === 'tuple' || a.kind === 'fixed-array' || b.kind === 'fixed-array') {
    if (a.kind !== b.kind || !arr(a.elements) || !arr(b.elements) || a.elements.length !== b.elements.length ||
        (a.kind === 'fixed-array' && a.readOnly === true && b.readOnly !== true)) return false;
    return a.elements.every((x, i) => assign(x, b.elements[i], depth + 1, aBind, bBind) &&
      (a.kind !== 'fixed-array' || assign(b.elements[i], x, depth + 1, bBind, aBind)));
  }
  // Records are readonly width-compatible only when explicitly projected.
  if (!SHAPES.has(a.kind) || !SHAPES.has(b.kind)) return false;
  if (a.kind === 'struct' || b.kind === 'struct') {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'struct' && a.name !== b.name) return false;
  }
  if (a.kind !== b.kind || (a.readOnly === true && b.readOnly !== true)) return false;
  if (new Set(['class','trait','interface','contract']).has(a.kind) &&
      (!name(a.name) || a.name !== b.name)) return false;
  const af = fieldMap(a), bf = fieldMap(b);
  if (!af || !bf || af.size !== bf.size) return false;
  for (const [k, expected] of bf) {
    const actual = af.get(k);
    if (!actual || !assign(actual.type, expected.type, depth + 1, aBind, bBind)) return false;
  }
  return true;
}
function methodCompatible(actual, contract) {
  if (!plain(actual) || !plain(contract) ||
      !arr(actual.params) || !arr(contract.params) ||
      !arr(actual.generics ?? []) || !arr(contract.generics ?? []) ||
      !(actual.generics ?? []).every(name) || !(contract.generics ?? []).every(name) ||
      new Set(actual.generics ?? []).size !== (actual.generics ?? []).length ||
      new Set(contract.generics ?? []).size !== (contract.generics ?? []).length ||
      !typedesc(actual.result) || !typedesc(contract.result)) return false;
  for (const p of [...actual.params, ...contract.params])
    if (!plain(p) || !typedesc(p.type)) return false;
  if (!plain(actual) || !plain(contract) || !name(actual.name) || actual.name !== contract.name ||
      actual.public !== true || actual.static === true || actual.abstract === true ||
      (actual.async === true) !== (contract.async === true)) return false;
  const ag = actual.generics ?? [], bg = contract.generics ?? [];
  if (ag.length !== bg.length || actual.params.length !== contract.params.length) return false;
  for (let i = 0; i < contract.params.length; i++) {
    const ap = actual.params[i], bp = contract.params[i];
    if ((ap.mutable === true) !== (bp.mutable === true)) return false;
    // Parameter contravariance, preserving alpha-equivalent method generics.
    if (!assign(bp.type, ap.type, 0, bg, ag)) return false;
  }
  return assign(actual.result, contract.result, 0, ag, bg);
}
function structural(actual, wanted, depth) {
  if (depth > MAX_DEPTH || !plain(actual) || !plain(wanted)) return false;
  if (actual.actor === true || wanted.actor === true || wanted.mutable === true || wanted.readOnly !== true) return false;
  if (wanted.kind === 'tuple') return actual.kind === 'tuple' && assign(actual, wanted, depth);
  if (!SHAPES.has(wanted.kind) || !SHAPES.has(actual.kind) && actual.kind !== 'entry') return false;
  if (actual.kind === 'entry') {
    if (!arr(actual.args) || actual.args.length !== 2) return false;
    actual = {kind: 'record', fields: [
      {name:'key', type:actual.args[0], public:true},
      {name:'value', type:actual.args[1], public:true}
    ]};
  }
  const af = fieldMap(actual), bf = fieldMap(wanted);
  const am = methodsMap(actual), bm = methodsMap(wanted);
  if (!af || !bf || !am || !bm) return false;
  for (const [k, need] of bf) {
    const have = af.get(k);
    if (!have || have.public !== true || !assign(have.type, need.type, depth + 1)) return false;
  }
  for (const [key, need] of bm) if (!methodCompatible(am.get(key), need)) return false;
  return true;
}
/** Explicit readonly structural view: no host object reflection, no implicit nominal erosion. */
export function canBorrowStructural(actualType, targetType) {
  try { return structural(actualType, targetType, 0); } catch { return false; }
}
/** Nominal / ordinary compatibility never silently falls back to structural matching. */
export function canAssignNominal(actualType, expectedType) {
  try { return assign(actualType, expectedType); } catch { return false; }
}
/** Generic callable signature compatibility (shared by interfaces, traits, classes). */
export function canImplementMethod(candidateMethod, requiredMethod) {
  try { return methodCompatible(candidateMethod, requiredMethod); } catch { return false; }
}
