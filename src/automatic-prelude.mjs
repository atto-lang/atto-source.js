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
  ['Entry','alloc/map','explicit','type','payload'],
  ['int','core/primitive','core','type','copy','core/primitive/i64'],
  ['Int','core/primitive','core','type','copy','core/primitive/i64'],
  ['i8','core/primitive','core','type','copy','core/primitive/i8'],
  ['i16','core/primitive','core','type','copy','core/primitive/i16'],
  ['i32','core/primitive','core','type','copy','core/primitive/i32'],
  ['i64','core/primitive','core','type','copy','core/primitive/i64'],
  ['uint','core/primitive','core','type','copy','core/primitive/u64'],
  ['UInt','core/primitive','core','type','copy','core/primitive/u64'],
  ['u8','core/primitive','core','type','copy','core/primitive/u8'],
  ['u16','core/primitive','core','type','copy','core/primitive/u16'],
  ['u32','core/primitive','core','type','copy','core/primitive/u32'],
  ['u64','core/primitive','core','type','copy','core/primitive/u64'],
  ['bool','core/primitive','core','type','copy','core/primitive/bool'],
  ['Bool','core/primitive','core','type','copy','core/primitive/bool'],
  ['boolean','core/primitive','core','type','copy','core/primitive/bool'],
  ['char','core/primitive','core','type','copy','core/primitive/char'],
  ['Char','core/primitive','core','type','copy','core/primitive/char'],
  ['byte','core/primitive','core','type','copy','core/primitive/u8'],
  ['Byte','core/primitive','core','type','copy','core/primitive/u8'],
  ['float','core/primitive','core','type','copy','core/primitive/f64'],
  ['Float','core/primitive','core','type','copy','core/primitive/f64'],
  ['f32','core/primitive','core','type','copy','core/primitive/f32'],
  ['f64','core/primitive','core','type','copy','core/primitive/f64'],
  ['decimal','core/primitive','core','type','copy','core/primitive/decimal'],
  ['complex','core/primitive','core','type','copy','core/primitive/complex128'],
  ['complex64','core/primitive','core','type','copy','core/primitive/complex64'],
  ['complex128','core/primitive','core','type','copy','core/primitive/complex128'],
  ['string','core/primitive','core','type','copy','core/primitive/string-view']
];
const registry=new Map();
for(const [name,module,scope,kind,ownership,canonicalOverride] of names){
  if(registry.has(name))throw new Error('duplicate core prelude name');
  registry.set(name,Object.freeze({name,canonical:canonicalOverride??module+'/'+name,scope,kind,ownership}));
}
const protectedNames=new Set([
  'Option','Result','Some','None','Ok','Err','Array','FixedArray',
  'List','FixedList','Vector','Slice','Tuple','Map','Set','ReadLoan','WriteLoan'
]);

const arities = Object.freeze({
  Option:[1,1], Some:[1,1], None:[0,0], Result:[2,2], Ok:[1,1], Err:[1,1],
  Error:[0,0], Array:[1,2], FixedArray:[2,2], Slice:[1,1], Tuple:[0,32],
  Pair:[2,2], Iterator:[1,1], Range:[1,1], Eq:[0,0], Ord:[0,0],
  Ordering:[0,0], From:[1,1], Into:[1,1], TryFrom:[1,1], TryInto:[1,1],
  Display:[0,0], Debug:[0,0], Sendable:[0,0], String:[0,0], List:[1,1],
  Vec:[1,1], Map:[2,2], Set:[1,1], Box:[1,1], HashMap:[2,2], HashSet:[1,1],
  Entry:[2,2]
});
const variantsWithPayload = new Set(['Some','Ok','Err']);
const aggregateTypes = new Set(['Array','FixedArray','Tuple','Pair','Entry']);
const ownedStorageTypes = new Set(['String','List','Vec','Map','Set','Box','HashMap','HashSet']);
const sumTypes = new Set(['Option','Result','Some','Ok','Err']);
const scalarNames = new Set(['int','Int','i8','i16','i32','i64','uint','UInt','u8','u16','u32','u64','bool','Bool','boolean','char','Char','byte','Byte','float','Float','f32','f64','decimal','complex','complex64','complex128','string']);
const TYPE_REGISTRY = new Map();
for(const binding of registry.values()){
  const [minGenericArity,maxGenericArity]=arities[binding.name]??[0,0];
  const allocation=binding.ownership==='borrowed_view'?'borrowed_view':
    binding.scope==='alloc'?'allocator_required':'none';
  const dropPolicy=ownedStorageTypes.has(binding.name)?'owned_storage':
    aggregateTypes.has(binding.name)?'all_initialized_members':
    (binding.name==='Option'||binding.name==='Result'||variantsWithPayload.has(binding.name))
      ?'active_payload_once':binding.kind==='trait'?'not_a_value':'none';
  const sendPolicy=binding.ownership==='borrowed_view'?'never_borrowed':
    binding.kind==='trait'?'not_applicable':
    binding.ownership==='copy'?'always':'payload_dependent';
  const loweringStatus=sumTypes.has(binding.name)?'js_scalar_adt_subset':
    binding.name==='String'?'legacy_or_contract_string_view':
    scalarNames.has(binding.name)?'js_scalar_intrinsic':'contract_only';
  TYPE_REGISTRY.set(binding.name,Object.freeze({...binding,minGenericArity,maxGenericArity,
    allocation,dropPolicy,sendPolicy,loweringStatus}));
}
export const PRELUDE_BINDINGS=Object.freeze([...TYPE_REGISTRY.values()]);
export function typeInfo(name){return TYPE_REGISTRY.get(name)??null;}
export function resolvePrelude(name,profile=PreludeProfile.CORE){
  if(typeof name!=='string' || !Object.values(PreludeProfile).includes(profile))
    throw new TypeError('invalid prelude lookup');
  const entry=TYPE_REGISTRY.get(name);
  if(!entry || entry.scope===PreludeScope.EXPLICIT ||
    (entry.scope===PreludeScope.ALLOC && profile===PreludeProfile.CORE))return null;
  return entry;
}
export function isProtectedPreludeIdentity(name){
  return protectedNames.has(name);
}
export function isCoreSumCarrier(name,arity){
  const entry=TYPE_REGISTRY.get(name);
  return !!entry && entry.scope==='core' && entry.kind==='type' &&
    entry.ownership==='payload' && arity>=entry.minGenericArity &&
    arity<=entry.maxGenericArity && (name==='Option'||name==='Result');
}
export function isCoreConstructor(name){
  const entry=resolvePrelude(name,PreludeProfile.CORE);
  return entry!==null && entry.kind==='constructor';
}
