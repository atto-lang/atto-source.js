/**
 * Experimental compiler-only lexical binding foundation. No source syntax,
 * JavaScript runtime variable exposure, closure capture or mutation lowering.
 */
const TYPES = new Set(['int', 'bool', 'symbol', 'option<int>', 'result<int,int>']);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set([
  'self','return','const','let','val','if','then','else','fi','end',
  'true','false','new','class','actor','pub','define','module','fnc','routine',
  'Option','Result','Symbol','int','bool','void','match','on',
  '__proto__','prototype','constructor'
]);
const MAX_BINDINGS = 30000;
const MAX_DEPTH = 192;

export class LexicalConstError extends Error {
  constructor(message) {
    super('error: lexical const v0: ' + message);
    this.name = 'LexicalConstError';
  }
}
const fail = message => { throw new LexicalConstError(message); };
const validName = name => {
  if (typeof name !== 'string' || !IDENT.test(name) || RESERVED.has(name))
    fail('invalid or reserved binding name');
  return name;
};
const validType = type => {
  if (typeof type !== 'string' || !TYPES.has(type)) fail('unsupported binding type');
  return type;
};

export class LexicalConstScope {
  #parent;
  #slots;
  #bindings = new Map();
  #depth;
  constructor(parent = null) {
    // Never accept caller-controlled slot allocators or nesting depth. They
    // could reset slot identity, create negative slots or bypass scope budgets.
    if (arguments.length > 1) fail('scope allocator/depth override forbidden');
    if (parent !== null &&
        (typeof parent !== 'object' || !(#depth in parent)))
      fail('invalid scope parent');
    const depth = parent === null ? 0 : parent.#depth + 1;
    if (depth > MAX_DEPTH) fail('scope depth budget exceeded');
    this.#parent = parent;
    this.#slots = parent === null ? {next: 0} : parent.#slots;
    this.#depth = depth;
  }
  static root(parameters = [], paramTypes = []) {
    if (!Array.isArray(parameters) || !Array.isArray(paramTypes))
      fail('invalid parameters');
    // Snapshot native array length descriptors once: a Proxy get trap must
    // never alter the parameter budget or control the binding loop.
    const count = Object.getOwnPropertyDescriptor(parameters,'length')?.value;
    const typeCount = Object.getOwnPropertyDescriptor(paramTypes,'length')?.value;
    if (!Number.isSafeInteger(count) || count < 0 || count > 128 ||
        typeCount !== count)
      fail('invalid parameters');
    const scope = new LexicalConstScope();
    for (let i=0; i<count; i++) {
      // Do not invoke getters in host-provided compiler parameter metadata.
      const parameter = Object.getOwnPropertyDescriptor(parameters,String(i));
      const declaredType = Object.getOwnPropertyDescriptor(paramTypes,String(i));
      if (!Object.hasOwn(parameter??{},'value') ||
          !Object.hasOwn(declaredType??{},'value'))
        fail('invalid parameter descriptors');
      const name=validName(parameter.value), type=validType(declaredType.value);
      if (scope.#bindings.has(name)) fail('duplicate parameter ' + name);
      scope.#bindings.set(name,Object.freeze({kind:'param',index:i,name,type}));
    }
    return scope;
  }
  child() {
    return new LexicalConstScope(this);
  }
  #lookup(name) {
    return this.#bindings.get(name) ?? this.#parent?.#lookup(name) ?? null;
  }
  declare_const(name,type) {
    validName(name);validType(type);
    // Never delegate invariant checks to overridable public resolve().
    if (this.#lookup(name)!==null) fail('binding shadows an existing name ' + name);
    if (this.#slots.next >= MAX_BINDINGS) fail('binding slot budget exceeded');
    const binding=Object.freeze({kind:'local',name,type,slot:this.#slots.next++});
    this.#bindings.set(name,binding);
    return binding;
  }
  resolve(name) {
    validName(name);
    return this.#lookup(name);
  }
}

/**
 * Build a nested lexical declaration tree from a bounded statement sequence.
 * The initializer runs before the continuation, exactly once. Callers must
 * resolve/type-check expressions before admitting this tree to program IR.
 */
export function lower_const_sequence(statements, fallback = null) {
  if (!Array.isArray(statements))
    fail('invalid statement sequence');
  // Avoid invoking a caller Proxy's length getter before or during lowering.
  const count=Object.getOwnPropertyDescriptor(statements,'length')?.value;
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_BINDINGS)
    fail('invalid statement sequence');
  let result=fallback;
  let declarationDepth=0;
  for (let i=count-1; i>=0; i--) {
    // Array indexing must not execute a caller-supplied getter during IR
    // construction. Validate an own data slot before inspecting its value.
    const descriptor=Object.getOwnPropertyDescriptor(statements,String(i));
    if (!Object.hasOwn(descriptor??{},'value')) fail('invalid lexical statement slot');
    const item=descriptor.value;
    if (!item || typeof item!=='object' || Array.isArray(item) ||
        Object.getPrototypeOf(item)!==Object.prototype)
      fail('invalid lexical statement');
    const keys=Reflect.ownKeys(item);
    // Snapshot exactly the admitted own data descriptors. Never reread the
    // original object through a Proxy get trap after checking its descriptors.
    const fields=Object.create(null);
    for(const key of keys){
      const desc=Object.getOwnPropertyDescriptor(item,key);
      if(typeof key!=='string'||!Object.hasOwn(desc??{},'value'))
        fail('accessor or symbol-keyed statement');
      fields[key]=desc.value;
    }
    if (fields.kind==='return') {
      if (keys.length!==2 || !keys.includes('kind') || !keys.includes('value') ||
          result!==null) fail('unreachable or malformed return');
      result=fields.value;
    } else if (fields.kind==='const') {
      if (++declarationDepth > MAX_DEPTH) fail('nested const depth budget exceeded');
      if (keys.length!==4 || !['kind','name','type','value'].every(k=>keys.includes(k)))
        fail('malformed const declaration');
      validName(fields.name);validType(fields.type);
      if (result===null) fail('const declaration requires returning continuation');
      result={kind:'localDecl',name:fields.name,type:fields.type,value:fields.value,body:result};
    } else fail('unsupported lexical statement');
  }
  if (result===null) fail('missing return');
  return result;
}
