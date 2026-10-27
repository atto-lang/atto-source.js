/**
 * Versioned, JSON-safe checked inverted-class IR. Independent of source lexer
 * and runtime. This is a backend-local prototype, not yet canonical HIR/MIR.
 * Validation returns detached plain records; caller-owned nodes are never
 * used for code generation after admission.
 */
export const INVERTED_IR_VERSION = 1;
export const INVERTED_IR_DIALECT = "oreslang.inverted";
export const INVERTED_IR_INT_MODEL = "signed-i64-checked";
const NAME = /^[A-Za-z_][A-Za-z_0-9]{0,127}$/;
const SIGNED = /^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/;
const TYPES = new Set(["i64","f64","bool"]);
const MIN = -(1n << 63n), MAX = (1n << 63n) - 1n;

export class InvertedIRError extends Error {
  constructor(detail){super("error: inverted IR: "+detail);this.name="InvertedIRError";}
}
const fail = detail => {throw new InvertedIRError(detail);};
function ownRecord(value,keys,context) {
  if(value===null || typeof value!=="object" || Array.isArray(value))
    fail(context+": record expected");
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype && prototype!==null)
    fail(context+": unsupported object prototype");
  const actual=Reflect.ownKeys(value);
  if(actual.length!==keys.length ||
     actual.some(k=>typeof k!=="string"||!keys.includes(k)))
    fail(context+": missing/extra/accessor properties");
  for(const key of keys) {
    const desc=Object.getOwnPropertyDescriptor(value,key);
    if(!desc || !Object.hasOwn(desc,"value"))
      fail(context+": accessor/missing property "+key);
  }
  return value;
}
function dense(value,max,context) {
  if(!Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype ||
     value.length>max)fail(context+": bounded dense array required");
  const keys=Reflect.ownKeys(value);
  if(keys.length!==value.length+1 ||
     keys.some(k=>k!=="length"&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=value.length)))
    fail(context+": sparse/extra array properties");
  for(let i=0;i<value.length;i++){
    const desc=Object.getOwnPropertyDescriptor(value,String(i));
    if(!desc||!Object.hasOwn(desc,"value"))
      fail(context+": accessor/sparse array element");
  }
  return value;
}
function ident(value,context) {
  if(typeof value!=="string" || !NAME.test(value))fail(context+": invalid identifier");
  return value;
}
function nat(value,max,context) {
  if(typeof value!=="number" || !Number.isSafeInteger(value) ||
     Object.is(value,-0) || value<0 || value>max)
    fail(context+": invalid integer index");
  return value;
}
function scalar(value,type,context) {
  ownRecord(value,["type","value"],context);
  if(value.type!==type)fail(context+": field type mismatch");
  const s=value.value;
  if(typeof s!=="string" || s.length>128)fail(context+": invalid value");
  if(type==="i64"){
    if(!SIGNED.test(s) || s.length>20)fail(context+": invalid canonical i64");
    const number=BigInt(s);
    if(number<MIN||number>MAX)fail(context+": signed i64 overflow");
  } else if(type==="f64"){
    // Preserve only canonical finite JS literals, with no NaN/Infinity,
    // exponent ambiguities or executable text passing to ESM generation.
    const number=Number(s);
    if(!Number.isFinite(number) || String(number)!==s)
      fail(context+": invalid canonical finite f64");
  } else if(type==="bool" && s!=="true" && s!=="false")
    fail(context+": invalid bool");
  return {type,value:s};
}
function index(value,owner,defined,context){
  if(value===null || typeof value!=="object")fail(context+": index missing");
  if(value.kind==="position"){
    ownRecord(value,["kind","value"],context);
    const checked=scalar({type:"i64",value:value.value},"i64",context);
    return {kind:"position",value:checked.value};
  }
  if(value.kind==="handle"){
    ownRecord(value,["kind","slot"],context);
    const slot=nat(value.slot,defined.length-1,context);
    if(!defined[slot] || defined[slot].kind!=="handle" || defined[slot].owner!==owner)
      fail(context+": foreign/stale-layout handle type");
    return {kind:"handle",slot};
  }
  fail(context+": unsupported index form");
}
export function validateInvertedIRV1(input) {
  ownRecord(input,["schemaVersion","dialect","integerModel","schema","statements"],"program");
  if(input.schemaVersion!==INVERTED_IR_VERSION ||
     input.dialect!==INVERTED_IR_DIALECT ||
     input.integerModel!==INVERTED_IR_INT_MODEL)
    fail("version, dialect or integer model mismatch");
  ownRecord(input.schema,["name","fields"],"schema");
  const schemaName=ident(input.schema.name,"schema");
  const seen=new Set();
  const fields=dense(input.schema.fields,64,"fields").map((item,i)=>{
    ownRecord(item,["name","type"],"field");
    const name=ident(item.name,"field");
    if(seen.has(name))fail("duplicate field "+name);
    seen.add(name);
    if(!TYPES.has(item.type))fail("unsupported field type");
    return {name,type:item.type};
  });
  if(fields.length===0)fail("empty inverted schema");
  const operations=dense(input.statements,256,"statements");
  if(operations.length<2)fail("missing ownership/return operations");
  const defined=[];
  let returned=false;
  let totalNodes=0;
  const getOwner=(v,context)=>{
    const owner=nat(v,defined.length-1,context);
    if(!defined[owner] || defined[owner].kind!=="array")fail(context+": non-owning array slot");
    return owner;
  };
  const getField=(v,context)=>{
    const field=nat(v,fields.length-1,context);
    if(!fields[field])fail(context+": unknown field");
    return field;
  };
  function expr(v,depth=0){
    if(++totalNodes>8192 || depth>128)fail("expression complexity exceeded");
    if(!v || typeof v!=="object")fail("invalid expression");
    if(v.kind==="literal"){
      ownRecord(v,["kind","value"],"integer literal");
      return {kind:"literal",value:scalar({type:"i64",value:v.value},"i64","literal").value};
    }
    if(v.kind==="read"){
      ownRecord(v,["kind","owner","index","field"],"field read");
      const owner=getOwner(v.owner,"read owner"),field=getField(v.field,"read field");
      if(fields[field].type!=="i64")fail("return expression reads non-i64 field");
      return {kind:"read",owner,index:index(v.index,owner,defined,"read index"),field};
    }
    if(v.kind==="add"){
      ownRecord(v,["kind","left","right"],"checked add");
      return {kind:"add",left:expr(v.left,depth+1),right:expr(v.right,depth+1)};
    }
    fail("unsupported expression kind");
  }
  const statements=operations.map((step,i)=>{
    if(returned)fail("statement after return");
    if(!step || typeof step!=="object")fail("invalid statement");
    switch(step.kind){
      case "alloc":{
        ownRecord(step,["kind","slot","capacity"],"allocate");
        const slot=nat(step.slot,255,"allocation slot");
        if(slot!==defined.length)fail("non-sequential allocation slot");
        const capacity=nat(step.capacity,2147483647,"capacity");
        if(capacity<1)fail("zero array capacity");
        defined.push({kind:"array"});
        return {kind:"alloc",slot,capacity};
      }
      case "push":{
        ownRecord(step,["kind","slot","owner","values"],"row push");
        const slot=nat(step.slot,255,"handle slot");
        if(slot!==defined.length)fail("non-sequential handle slot");
        const owner=getOwner(step.owner,"push owner");
        const supplied=dense(step.values,64,"row values");
        if(supplied.length!==fields.length)fail("row field count mismatch");
        const values=supplied.map((v,j)=>scalar(v,fields[j].type,"row field "+fields[j].name));
        defined.push({kind:"handle",owner});
        return {kind:"push",slot,owner,values};
      }
      case "write":{
        ownRecord(step,["kind","owner","index","field","value"],"field write");
        const owner=getOwner(step.owner,"write owner"),field=getField(step.field,"write field");
        const idx=index(step.index,owner,defined,"write index");
        return {kind:"write",owner,index:idx,field,value:scalar(step.value,fields[field].type,"write value")};
      }
      case "erase":{
        ownRecord(step,["kind","owner","handle"],"erase");
        const owner=getOwner(step.owner,"erase owner");
        const slot=nat(step.handle,defined.length-1,"erase handle");
        if(!defined[slot]||defined[slot].kind!=="handle"||defined[slot].owner!==owner)
          fail("erase cross-owner/non-handle");
        return {kind:"erase",owner,handle:slot};
      }
      case "return":{
        ownRecord(step,["kind","expr"],"return");
        if(i!==operations.length-1)fail("return is not terminal");
        returned=true;
        return {kind:"return",expr:expr(step.expr)};
      }
      default:fail("unsupported statement kind");
    }
  });
  if(!returned || !defined.some(v=>v.kind==="array"))fail("program must allocate and return");
  return {
    schemaVersion:INVERTED_IR_VERSION,dialect:INVERTED_IR_DIALECT,
    integerModel:INVERTED_IR_INT_MODEL,
    schema:{name:schemaName,fields},
    statements
  };
}
