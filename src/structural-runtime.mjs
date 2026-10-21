import {canBorrowStructural} from './structural-types.mjs';

/**
 * Executable scalar-field structural view for compiler-generated typed IR.
 * No source parser, methods, aggregate slots, actor values or host-shape fallback.
 * Definitions and values are unforgeable within one domain via private WeakMaps.
 */
export function createStructuralDomain() {
  const types = new WeakMap();
  const values = new WeakMap();
  const plans = new WeakMap();
  const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
  const excluded = new Set(['__proto__', 'prototype', 'constructor']);
  function onlyPlain(x) {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) throw new TypeError('expected plain shape metadata');
    const p = Object.getPrototypeOf(x);
    if (p !== null && p !== Object.prototype) throw new TypeError('untrusted metadata prototype');
    for (const k of Reflect.ownKeys(x)) {
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (typeof k !== 'string' || !d || !Object.hasOwn(d, 'value')) throw new TypeError('accessors and symbol metadata forbidden');
    }
    return x;
  }
  function exactRecord(x, allowed, required=[]) {
    onlyPlain(x);
    const keys=Reflect.ownKeys(x);
    if(keys.some(k=>!allowed.includes(k)) || required.some(k=>!Object.hasOwn(x,k)))
      throw new TypeError('missing or unrecognized metadata key');
    return x;
  }
  function denseDataArray(input, max=128) {
    if (!Array.isArray(input) || input.length > max || Object.getPrototypeOf(input) !== Array.prototype)
      throw new TypeError('untrusted array metadata');
    for (const key of Reflect.ownKeys(input)) {
      if (key === 'length') continue;
      if (!/^(?:0|[1-9][0-9]*)$/.test(String(key)) || Number(key) >= input.length)
        throw new TypeError('noncanonical metadata array key');
      const d = Object.getOwnPropertyDescriptor(input,key);
      if (!d || !Object.hasOwn(d,'value')) throw new TypeError('array getters forbidden');
    }
    if (Object.keys(input).length !== input.length)
      throw new TypeError('sparse metadata array forbidden');
    return input;
  }
  const allowed = new Set(['int','string','bool']);
  function validField(f) {
    exactRecord(f,['name','type','public'],['name','type','public']);
    if (!identifier.test(f.name) || excluded.has(f.name) || !allowed.has(f.type) || typeof f.public !== 'boolean')
      throw new TypeError('unsupported scalar field descriptor');
    return Object.freeze({name:f.name,type:f.type,public:f.public});
  }
  function defineType(metadata) {
    exactRecord(metadata,['kind','name','actor','fields','methods'],['kind','fields']);
    if (!['record','class','struct'].includes(metadata.kind) ||
        (metadata.actor !== undefined && metadata.actor !== false) ||
        (metadata.kind==='record' && metadata.name !== undefined) ||
        !Array.isArray(metadata.fields) || metadata.fields.length>128 ||
        (metadata.methods !== undefined && !Array.isArray(metadata.methods)))
      throw new TypeError('unsupported typed scalar carrier');
    if(metadata.methods !== undefined && denseDataArray(metadata.methods,0).length !== 0)
      throw new TypeError('unsupported typed scalar carrier methods');
    const fields = denseDataArray(metadata.fields).map(validField);
    if (new Set(fields.map(x=>x.name)).size !== fields.length) throw new TypeError('duplicate field');
    if (metadata.kind!=='record' && (!identifier.test(metadata.name) || excluded.has(metadata.name)))
      throw new TypeError('nominal carrier needs safe name');
    const shape = Object.freeze({kind:metadata.kind, name: metadata.name,
      actor:false,fields:Object.freeze(fields), methods:Object.freeze([])});
    const token = Object.freeze(Object.create(null));
    types.set(token,{shape,index:new Map(fields.map((f,i)=>[f.name,i]))});
    return token;
  }
  function validScalar(type, value) {
    if (type==='int') return typeof value==='bigint' && value >= -(1n<<63n) && value <= (1n<<63n)-1n;
    if (type==='bool') return typeof value==='boolean';
    return typeof value==='string';
  }
  function createValue(token, slots) {
    const def=types.get(token);
    if (!def || !Array.isArray(slots) || slots.length!==def.shape.fields.length)
      throw new TypeError('invalid typed carrier or slot arity');
    denseDataArray(slots);
    for(let i=0;i<slots.length;i++)
      if(!validScalar(def.shape.fields[i].type, slots[i]))throw new TypeError('slot type mismatch');
    const obj=Object.freeze(Object.create(null));
    values.set(obj,{token,slots:Object.freeze([...slots])});
    return obj;
  }
  function compileView(token, expected) {
    const def=types.get(token);
    exactRecord(expected,['kind','readOnly','fields'],['kind','readOnly','fields']);
    if(!def || expected.readOnly !== true ||
       !Array.isArray(expected.fields) || expected.fields.length>128 ||
       (expected.methods !== undefined && !Array.isArray(expected.methods)))
      throw new TypeError('unsupported view plan');
    if(expected.methods !== undefined && denseDataArray(expected.methods,0).length !== 0)
      throw new TypeError('unsupported view plan methods');
    const fields=denseDataArray(expected.fields).map(validField);
    if(fields.some(f=>!f.public) || new Set(fields.map(x=>x.name)).size!==fields.length)
      throw new TypeError('invalid view fields');
    const target={kind:expected.kind,readOnly:true,fields,methods:[]};
    if(!canBorrowStructural(def.shape,target))throw new TypeError('structural type proof failed');
    const indexes=fields.map(f=>def.index.get(f.name));
    const plan=Object.freeze(Object.create(null));
    plans.set(plan,{token,fields,indexes});
    return plan;
  }
  function withView(instance,plan,callback) {
    const val=values.get(instance), compiled=plans.get(plan);
    if(!val || !compiled || val.token!==compiled.token || typeof callback!=='function')
      throw new TypeError('forged carrier, plan or receiver type');
    let active=true;
    const view=Object.create(null);
    for(let i=0;i<compiled.fields.length;i++) {
      const idx=compiled.indexes[i];
      Object.defineProperty(view,compiled.fields[i].name,{
        enumerable:true,configurable:false,
        get(){if(!active)throw new Error('expired structural view loan');return val.slots[idx];}
      });
    }
    Object.freeze(view);
    try {
      const result=callback(view);
      if(result!==null && (typeof result==='object' || typeof result==='function'))
        throw new TypeError('structural view result must be scalar/non-escaping');
      return result;
    } finally {active=false;}
  }
  return Object.freeze({defineType,createValue,compileView,withView});
}
