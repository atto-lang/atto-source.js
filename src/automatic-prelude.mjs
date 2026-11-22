// Compile-time Atto prelude names. This is NOT a JavaScript global, runtime
// registry, host import or evidence that any given target implements the type.
// The JS freestanding compiler deliberately admits only its verified subset.
export const PreludeProfile = Object.freeze({CORE:'core', ALLOC:'alloc', HOSTED:'hosted'});
export const PreludeScope = Object.freeze({CORE:'core', ALLOC:'alloc', EXPLICIT:'explicit'});

const names=[
  ['Option','core/option','core','type','payload'],
  ['Some','core/option','core','constructor','payload'],
  ['None','core/option','core','constructor','payload'],
  ['Result','core/result','core','type','payload'],
  ['Ok','core/result','core','constructor','payload'],
  ['Err','core/result','core','constructor','payload'],
  ['Error','core/error','core','type','owned'],
  ['Array','core/array','core','type','payload'],
  ['FixedArray','core/array','core','type','payload'],
  ['Slice','core/slice','core','type','borrowed_view'],
  ['Tuple','core/tuple','core','type','payload'],
  ['Pair','core/tuple','core','type','payload'],
  ['Iterator','core/iter','core','trait','trait'],
  ['Range','core/range','core','type','payload'],
  ['Eq','core/cmp','core','trait','trait'],
  ['Ord','core/cmp','core','trait','trait'],
  ['Ordering','core/cmp','core','type','payload'],
  ['From','core/convert','core','trait','trait'],
  ['Into','core/convert','core','trait','trait'],
  ['TryFrom','core/convert','core','trait','trait'],
  ['TryInto','core/convert','core','trait','trait'],
  ['Display','core/fmt','core','trait','trait'],
  ['Debug','core/fmt','core','trait','trait'],
  ['Sendable','core/marker','core','trait','trait'],
  ['String','alloc/string','alloc','type','owned'],
  ['List','alloc/list','alloc','type','owned'],
  ['Vec','alloc/vec','alloc','type','owned'],
  ['Map','alloc/map','alloc','type','owned'],
  ['Set','alloc/set','alloc','type','owned'],
  ['Box','alloc/box','alloc','type','owned'],
  ['HashMap','alloc/hash_map','explicit','type','owned'],
  ['HashSet','alloc/hash_set','explicit','type','owned'],
  ['Entry','alloc/map','explicit','type','payload']
];
const registry=new Map();
for(const [name,module,scope,kind,ownership] of names){
  if(registry.has(name))throw new Error('duplicate core prelude name');
  registry.set(name,Object.freeze({name,canonical:module+'/'+name,scope,kind,ownership}));
}
const protectedNames=new Set([
  'Option','Result','Some','None','Ok','Err','Array','FixedArray',
  'List','FixedList','Vector','Slice','Tuple','Map','Set','ReadLoan','WriteLoan'
]);

export const PRELUDE_BINDINGS=Object.freeze([...registry.values()]);
export function resolvePrelude(name,profile=PreludeProfile.CORE){
  if(typeof name!=='string' || !Object.values(PreludeProfile).includes(profile))
    throw new TypeError('invalid prelude lookup');
  const entry=registry.get(name);
  if(!entry || entry.scope===PreludeScope.EXPLICIT ||
    (entry.scope===PreludeScope.ALLOC && profile===PreludeProfile.CORE))return null;
  return entry;
}
export function isProtectedPreludeIdentity(name){
  return protectedNames.has(name);
}
export function isCoreSumCarrier(name,arity){
  return (name==='Option' && arity===1) || (name==='Result' && arity===2);
}
export function isCoreConstructor(name){
  const entry=resolvePrelude(name,PreludeProfile.CORE);
  return entry!==null && entry.kind==='constructor';
}
