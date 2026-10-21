import {canBorrowStructural} from './structural-types.mjs';

/**
 * Experimental, bounded typed-IR -> ESM bridge for readonly scalar-field
 * structural projections. This does not parse Oreslang source, lower methods,
 * transfer actor values, or implement general aggregate/async semantics.
 */
export class StructuralProjectionError extends Error {
  constructor(message) {super(`structural typed IR: ${message}`);this.name='StructuralProjectionError';}
}
const fail=message=>{throw new StructuralProjectionError(message);};
const name=value=>typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)&&
  !['__proto__','prototype','constructor'].includes(value);
function record(value,keys,required=[]){
  if(value===null||typeof value!=='object'||Array.isArray(value) ||
     ![null,Object.prototype].includes(Object.getPrototypeOf(value)))fail('expected plain record');
  const actual=Reflect.ownKeys(value);
  if(actual.some(k=>typeof k!=='string'||!keys.includes(k))||required.some(k=>!actual.includes(k)))
    fail('missing or unrecognized metadata key');
  for(const key of actual){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!Object.hasOwn(descriptor,'value'))fail('metadata accessor denied');
  }
  return value;
}
function array(value,max=64){
  if(!Array.isArray(value)||value.length>max||Object.getPrototypeOf(value)!==Array.prototype)
    fail('invalid metadata array');
  if(Reflect.ownKeys(value).length!==value.length+1)fail('noncanonical metadata array');
  for(let i=0;i<value.length;i++){
    const desc=Object.getOwnPropertyDescriptor(value,String(i));
    if(!desc||!Object.hasOwn(desc,'value'))fail('sparse or accessor-backed metadata array');
  }
  return value;
}
const scalarTypes=new Set(['int','bool','string']);
function fields(input,publicOnly){
  const result=[];
  const seen=new Set();
  for(const f of array(input)){
    record(f,['name','type','public'],['name','type','public']);
    if(!name(f.name)||seen.has(f.name)||!scalarTypes.has(f.type)||typeof f.public!=='boolean'||
       (publicOnly&&f.public!==true))fail('invalid scalar field descriptor');
    seen.add(f.name);result.push({name:f.name,type:f.type,public:f.public});
  }
  return result;
}
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
function literals(values,descriptors){
  array(values);
  if(values.length!==descriptors.length)fail('slot arity mismatch');
  return values.map((slot,i)=>{
    const type=descriptors[i].type;
    if(type==='int'){
      if(typeof slot!=='string'||!/^\-?(?:0|[1-9][0-9]*)$/.test(slot)||slot==='-0')
        fail('noncanonical signed i64 literal');
      const n=BigInt(slot);if(n<MIN||n>MAX)fail('signed i64 literal out of range');
      return `BigInt(${JSON.stringify(slot)})`;
    }
    if(type==='bool'){
      if(typeof slot!=='boolean')fail('invalid bool slot');
      return String(slot);
    }
    if(typeof slot!=='string'||slot.length>4096)fail('invalid string slot');
    return JSON.stringify(slot);
  });
}
/**
 * Accepts only a small validated subset of compiler-produced typed IR. Output
 * imports the existing branded structural runtime from this package.
 */
export function compileStructuralProjectionIR(input,{portable=false}={}){
  record(input,['schemaVersion','kind','mode','carrier','view','slots','select'],
    ['schemaVersion','kind','mode','carrier','view','slots','select']);
  if(input.schemaVersion!==1||input.kind!=='readonly-scalar-projection'||
    !['explicit','inline-anonymous'].includes(input.mode))fail('unsupported typed IR profile');
  record(input.carrier,['kind','name','fields'],['kind','fields']);
  if(!['record','class','struct'].includes(input.carrier.kind)||
    (input.carrier.kind!=='record'&&!name(input.carrier.name))||
    (input.carrier.kind==='record'&&input.carrier.name!==undefined))
    fail('unsupported carrier kind/identity');
  record(input.view,['kind','readOnly','fields'],['kind','readOnly','fields']);
  if(!['record','struct','interface','trait','class','contract'].includes(input.view.kind)||
     input.view.readOnly!==true||
     (input.mode==='inline-anonymous'&&!['record','struct'].includes(input.view.kind)))
    fail('view must be readonly; only anonymous record/struct contracts are implicitly structural');
  const carrier={kind:input.carrier.kind,fields:fields(input.carrier.fields,false)};
  if(input.carrier.kind!=='record')carrier.name=input.carrier.name;
  const view={kind:input.view.kind,readOnly:true,fields:fields(input.view.fields,true)};
  if(!name(input.select)||!view.fields.some(f=>f.name===input.select))
    fail('selected member is not in readonly view');
  if(!canBorrowStructural(carrier,view))fail('structural shape proof failed');
  const slotExpressions=literals(input.slots,carrier.fields);
  if(portable){
    // This IR admits literal scalar slots and a single selected field only.
    // Type proof is complete before code emission; the projection can therefore
    // be constant-folded without a host runtime, retaining checked BigInt i64.
    // Do not serialize any unused, possibly private carrier slots into ESM.
    const selected=carrier.fields.findIndex(f=>f.name===input.select);
    if(selected<0)fail('proved projection has no carrier slot');
    return [
      '// Oreslang standalone static typed-IR projection. NOT general source-language lowering.',
      'export function main(){',
      '  return '+slotExpressions[selected]+';',
      '}',
      ''
    ].join('\n');
  }
  return [
    '// Oreslang experimental *typed-IR* readonly structural scalar projection, not source-language parity.',
    "import {createStructuralDomain} from '@oreslang/source-js/structural-runtime';",
    'const _domain=createStructuralDomain();',
    `const _type=_domain.defineType(${JSON.stringify(carrier)});`,
    `const _plan=_domain.compileView(_type,${JSON.stringify(view)});`,
    'export function main(){',
    `  const _value=_domain.createValue(_type,[${slotExpressions.join(',')}]);`,
    `  return _domain.withView(_value,_plan,_view=>_view[${JSON.stringify(input.select)}]);`,
    '}',
    ''
  ].join('\n');
}
