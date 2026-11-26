// Core callable identities are separate from the type/constructor registry.
// These are compiler-bound reductions, not eager JavaScript functions.
const entries = Object.freeze(['And','Or','Xor'].map(name=>Object.freeze({
  name, canonical:'core/bool/'+name, scope:'core', kind:'callable_intrinsic',
  allocation:'none', scalarEvaluation:name==='Xor'?'eager_left_to_right':'short_circuit',
  arrayEvaluation:'eager_literal_pack_then_reduce',
  emptyIdentity:name==='And', loweringStatus:'js_scalar_and_literal_pack'
})));
const byName=new Map(entries.map(entry=>[entry.name,entry]));
const selectors=new Set(['atto.core/bool','core/bool','atto.core/bool.atto','core/bool.atto']);
export const CORE_BOOLEAN_CALLABLES=entries;
export const coreBooleanIntrinsic=name=>byName.get(name)??null;
export const isCoreBooleanUnit=path=>selectors.has(path);
