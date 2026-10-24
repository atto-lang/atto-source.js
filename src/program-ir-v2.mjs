/**
 * Strict JSON-safe resolved IR contract for the experimental program-v2 backend.
 * This is a backend-local migration seam, NOT yet the shared canonical Oreslang IR.
 */
export const PROGRAM_IR_VERSION=2;
export const PROGRAM_IR_DIALECT='oreslang.program';
export const PROGRAM_IR_INT_MODEL='signed-i64-checked-provisional';
const ID=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const DEC=/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/;
const MIN=-(1n<<63n), MAX=(1n<<63n)-1n;
const LIMIT_NODES=30000,LIMIT_DEPTH=192;
export class ProgramIRError extends Error {
  constructor(detail) {super('error: program IR: '+detail);this.name='ProgramIRError';}
}
const fail=s=>{throw new ProgramIRError(s);};
function record(v,keys,context) {
  if(v===null || typeof v!=='object' || Array.isArray(v))fail(context+': expected object');
  const proto=Object.getPrototypeOf(v);
  if(proto!==null && proto!==Object.prototype)fail(context+': non-plain object');
  const own=Reflect.ownKeys(v);
  if(own.length!==keys.length || own.some(k=>typeof k!=='string'||!keys.includes(k)))
    fail(context+': missing/extra fields');
  for(const key of keys){
    const desc=Object.getOwnPropertyDescriptor(v,key);
    if(!desc || !Object.hasOwn(desc,'value'))fail(context+': accessor/missing '+key);
  }
  return v;
}
function sequence(v,max,context){
  if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length>max)
    fail(context+': invalid array');
  const own=Reflect.ownKeys(v);
  if(own.length!==v.length+1 || own.some(k=>k!=='length'&&(!/^(?:0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length)))
    fail(context+': unexpected array properties');
  for(let i=0;i<v.length;i++) {
    const desc=Object.getOwnPropertyDescriptor(v,i);
    if(!desc||!Object.hasOwn(desc,'value'))fail(context+': accessor/sparse array');
  }
  return v;
}
function ident(s,where) {
  if(typeof s!=='string'||!ID.test(s))fail(where+': invalid identifier');
  return s;
}
function int(s){
  if(typeof s!=='string'||s.length>20||!DEC.test(s))fail('invalid canonical integer');
  const n=BigInt(s);
  if(n<MIN||n>MAX)fail('integer outside provisional signed i64');
  return s;
}
/**
 * Copy after validation, never return caller-owned IR references.
 * Direct object inputs are trusted data only, not a JavaScript sandbox.
 */
export function validateProgramIRV2(input) {
  record(input,['schemaVersion','dialect','integerModel','sourceNamespace','modules','functions'],'program');
  if(input.schemaVersion!==PROGRAM_IR_VERSION||input.dialect!==PROGRAM_IR_DIALECT||
     input.integerModel!==PROGRAM_IR_INT_MODEL)fail('unsupported IR version/dialect/model');
  const namespace=input.sourceNamespace===null?null:ident(input.sourceNamespace,'file namespace');
  const seenModules=new Set(),moduleNames=sequence(input.modules,512,'modules').map(m=>{
    const name=ident(m,'module name');
    if(seenModules.has(name))fail('duplicate module '+name);
    seenModules.add(name);
    return name;
  });
  const sourceFunctions=sequence(input.functions,512,'functions');
  if(!moduleNames.length && !sourceFunctions.length)fail('empty program');
  const slots=new Set(),symbolKinds=new Map(),exportNames=new Set(moduleNames);
  const headers=sourceFunctions.map(f=>{
    // Reject nulls and non-records before any optional-key introspection.
    // The full record(...) admission below checks plain prototypes and every
    // exact own-data field before reading function metadata.
    if(f===null||typeof f!=='object'||Array.isArray(f))
      fail('function: expected plain data object');
    const keys=Reflect.ownKeys(f);
    const typed=keys.includes('paramTypes')||keys.includes('returnType');
    record(f,typed?['module','name','kind','pub','params','body','paramTypes','returnType']:
      ['module','name','kind','pub','params','body'],'function');
    const module=f.module===null?null:ident(f.module,'owner module');
    if(module!==null && !seenModules.has(module))fail('missing owner module '+module);
    const name=ident(f.name,'function name');
    if(f.kind!=='fnc'&&f.kind!=='routine')fail('unknown function kind');
    if(typeof f.pub!=='boolean')fail('invalid visibility');
    if(f.kind==='routine'&&f.pub)fail('public routine cannot be exported');
    const params=sequence(f.params,128,'parameters').map(p=>ident(p,'parameter'));
    if(new Set(params).size!==params.length)fail('duplicate parameters');
    const paramTypes=typed?sequence(f.paramTypes,128,'paramTypes'):params.map(()=>'int');
    const types=['int','bool','option<int>','result<int,int>'];
    if(paramTypes.length!==params.length||
       paramTypes.some(t=>!types.includes(t)))fail('unsupported function parameter type');
    const returnType=typed?f.returnType:'int';
    if(!types.includes(returnType))fail('unsupported function return type');
    if(typed&&returnType==='int'&&paramTypes.every(t=>t==='int'))
      fail('redundant typed metadata on int-only function');
    const slot=(module===null?'@file/':'@module/'+module+'/')+name+'/'+params.length;
    if(slots.has(slot))fail('duplicate caller-visible method arity '+slot);
    const family=slot.slice(0,slot.lastIndexOf('/'));
    if(symbolKinds.has(family)&&symbolKinds.get(family)!==f.kind)
      fail('fnc/routine overload kind conflict '+family);
    symbolKinds.set(family,f.kind);
    slots.add(slot);
    if(module===null&&f.pub)exportNames.add(name);
    return {module,name,kind:f.kind,pub:f.pub,params,
      ...(typed?{paramTypes:[...paramTypes],returnType}: {})};
  });
  // Export-name collisions are legal only for overloads of the same root
  // function, and NEVER between a runtime module object and a root function.
  for(const header of headers)if(header.module===null&&header.pub&&seenModules.has(header.name))
    fail('file export conflicts with runtime module '+header.name);
  const graph=headers.map(()=>new Set());
  let nodes=0;
  const captureSlots=headers.map(()=>new Set());
  function node(expr,owner,depth=0,expected='int',active=[]){
    if(++nodes>LIMIT_NODES||depth>LIMIT_DEPTH)fail('expression complexity exceeded');
    if(!expr||typeof expr!=='object'||Array.isArray(expr))fail('invalid expression');
    const desc=Object.getOwnPropertyDescriptor(expr,'kind');
    if(!desc||!Object.hasOwn(desc,'value'))fail('invalid expression kind');
    // No implicit truthiness or numeric coercions, including in supplied IR.
    if(expected==='bool'&&['int','neg','binary'].includes(desc.value))
      fail('boolean expression required');
    if(expected!=='bool'&&['bool','compare','not'].includes(desc.value))
      fail('boolean value cannot be used as non-bool');
    if(expected!=='int'&&['int','neg','binary'].includes(desc.value))
      fail('integer expression cannot be used as non-int');
    switch(desc.value) {
      case 'int':
        record(expr,['kind','value'],'int');
        if(expected!=='int')fail('boolean expected, got int');
        return {kind:'int',value:int(expr.value)};
      case 'bool':
        record(expr,['kind','value'],'bool');
        if(expected!=='bool'||typeof expr.value!=='boolean')fail('invalid bool literal/type');
        return {kind:'bool',value:expr.value};
      case 'capture':
        record(expr,['kind','slot'],'capture');
        if(!Number.isSafeInteger(expr.slot)||Object.is(expr.slot,-0)||expr.slot<0||
           !active.includes(expr.slot))
          fail('ADT capture outside its typed payload scope');
        if(expected!=='int')fail('ADT int payload capture type mismatch');
        return {kind:'capture',slot:expr.slot};
      case 'param':
        record(expr,['kind','index'],'param');
        if(!Number.isSafeInteger(expr.index)||Object.is(expr.index,-0)||expr.index<0||expr.index>=headers[owner].params.length)
          fail('out-of-bounds parameter');
        if((headers[owner].paramTypes?.[expr.index]??'int')!==expected)
          fail('parameter type mismatch');
        return {kind:'param',index:expr.index};
      case 'neg':
        record(expr,['kind','inner'],'neg');
        if(expected!=='int')fail('int negation in boolean context');
        return {kind:'neg',inner:node(expr.inner,owner,depth+1,'int',active)};
      case 'not':
        record(expr,['kind','inner'],'not');
        if(expected!=='bool')fail('boolean negation in integer context');
        return {kind:'not',inner:node(expr.inner,owner,depth+1,'bool',active)};
      case 'binary':
        record(expr,['kind','op','left','right'],'binary');
        if(expected!=='int')fail('arithmetic in boolean context');
        if(!['+','-','*','%'].includes(expr.op))fail('unsupported binary operator');
        return {kind:'binary',op:expr.op,
          left:node(expr.left,owner,depth+1,'int',active),right:node(expr.right,owner,depth+1,'int',active)};
      case 'compare':
        record(expr,['kind','op','left','right'],'compare');
        if(expected!=='bool')fail('comparison in integer context');
        if(!['<','>','<=','>=','==','!='].includes(expr.op))fail('unsupported comparator');
        return {kind:'compare',op:expr.op,left:node(expr.left,owner,depth+1,'int',active),
          right:node(expr.right,owner,depth+1,'int',active)};
      case 'if':
        record(expr,['kind','condition','yes','no'],'if');
        return {kind:'if',condition:node(expr.condition,owner,depth+1,'bool',active),
          yes:node(expr.yes,owner,depth+1,expected,active),
          no:node(expr.no,owner,depth+1,expected,active)};
      case 'call': {
        record(expr,['kind','target','args'],'call');
        if(!Number.isSafeInteger(expr.target)||Object.is(expr.target,-0)||expr.target<0||expr.target>=headers.length)
          fail('invalid call target');
        const target=headers[expr.target];
        if((target.returnType??'int')!==expected)fail('call return type mismatch');
        const args=sequence(expr.args,128,'call args');
        if(args.length!==target.params.length)fail('call arity mismatch');
        if(target.module!==headers[owner].module && !target.pub)fail('cross-module private call');
        graph[owner].add(expr.target);
        return {kind:'call',target:expr.target,args:args.map((a,i)=>
          node(a,owner,depth+1,target.paramTypes?.[i]??'int',active))};
      }
      case 'namedCall': {
        record(expr,['kind','target','args','paramOrder'],'named call');
        if(!Number.isSafeInteger(expr.target)||Object.is(expr.target,-0)||
           expr.target<0||expr.target>=headers.length)fail('invalid named call target');
        const target=headers[expr.target];
        if((target.returnType??'int')!==expected)fail('named call return type mismatch');
        const args=sequence(expr.args,128,'named call args');
        const order=sequence(expr.paramOrder,128,'named call parameter order');
        if(args.length!==target.params.length||order.length!==args.length)
          fail('named call arity mismatch');
        const seen=new Set();
        const normalizedOrder=order.map(slot=>{
          if(!Number.isSafeInteger(slot)||Object.is(slot,-0)||slot<0||
             slot>=target.params.length||seen.has(slot))
            fail('invalid named call parameter order');
          seen.add(slot);return slot;
        });
        if(seen.size!==target.params.length)fail('incomplete named call parameter order');
        if(target.module!==headers[owner].module&&!target.pub)
          fail('cross-module private named call');
        graph[owner].add(expr.target);
        return {kind:'namedCall',target:expr.target,
          args:args.map((argument,i)=>node(argument,owner,depth+1,
            target.paramTypes?.[normalizedOrder[i]]??'int',active)),
          paramOrder:normalizedOrder};
      }
      case 'intrinsic': {
        record(expr,['kind','name','args'],'intrinsic');
        const signatures={
          'Option.some':[['int'],'option<int>'],
          'Option.none':[[],'option<int>'],
          'Option.is_some':[['option<int>'],'bool'],
          'Option.unwrap_or':[['option<int>','int'],'int'],
          'Result.ok':[['int'],'result<int,int>'],
          'Result.err':[['int'],'result<int,int>'],
          'Result.is_ok':[['result<int,int>'],'bool'],
          'Result.unwrap_or':[['result<int,int>','int'],'int'],
          'Result.unwrap_err_or':[['result<int,int>','int'],'int']
        };
        if(typeof expr.name!=='string'||!Object.hasOwn(signatures,expr.name))
          fail('unknown portable intrinsic');
        const [types,result]=signatures[expr.name];
        if(expected!==result)fail('intrinsic return type mismatch');
        const args=sequence(expr.args,2,'intrinsic args');
        if(args.length!==types.length)fail('intrinsic arity mismatch');
        return {kind:'intrinsic',name:expr.name,
          args:args.map((argument,i)=>node(argument,owner,depth+1,types[i],active))};
      }
      case 'adtMatch': {
        record(expr,['kind','adt','subject','arms'],'ADT match');
        if(expr.adt!=='option<int>'&&expr.adt!=='result<int,int>')
          fail('unknown ADT match type');
        const subject=node(expr.subject,owner,depth+1,expr.adt,active);
        const variants=expr.adt==='option<int>'?['Some','None']:['Ok','Err'];
        const arms=sequence(expr.arms,2,'ADT match arms');
        if(arms.length!==2)fail('non-exhaustive ADT match');
        const seen=new Set(),checked=[];
        for(const arm of arms){
          record(arm,['tag','slot','body'],'ADT match arm');
          if(!variants.includes(arm.tag)||seen.has(arm.tag))
            fail('ADT match has duplicate or inappropriate variant');
          seen.add(arm.tag);
          const payload=arm.tag!=='None';
          if(payload) {
            if(!Number.isSafeInteger(arm.slot)||Object.is(arm.slot,-0)||arm.slot<0||
               arm.slot>=LIMIT_NODES||captureSlots[owner].has(arm.slot)||active.includes(arm.slot))
              fail('invalid or repeated ADT payload slot');
            captureSlots[owner].add(arm.slot);
          } else if(arm.slot!==null)fail('None arm cannot bind a payload');
          const scopes=payload?[...active,arm.slot]:active;
          checked.push({tag:arm.tag,slot:arm.slot,
            body:node(arm.body,owner,depth+1,expected,scopes)});
        }
        if(seen.size!==2)fail('non-exhaustive ADT match');
        return {kind:'adtMatch',adt:expr.adt,subject,arms:checked};
      }
      case 'match': {
        record(expr,['kind','subject','arms'],'match');
        const subject=node(expr.subject,owner,depth+1,'int',active);
        const arms=sequence(expr.arms,256,'match arms');
        if(!arms.length)fail('empty match');
        let wildcard=false;
        const literals=new Set();
        const checked=arms.map(arm=>{
          record(arm,['value','body'],'match arm');
          let value;
          if(arm.value===null) {
            if(wildcard)fail('duplicate wildcard');
            wildcard=true;value=null;
          } else {
            if(wildcard)fail('unreachable arm after wildcard');
            value=int(arm.value);
            if(literals.has(value))fail('duplicate scalar pattern');
            literals.add(value);
          }
          return {value,body:node(arm.body,owner,depth+1,expected,active)};
        });
        if(!wildcard)fail('non-exhaustive int match');
        return {kind:'match',subject,arms:checked};
      }
      default:fail('unsupported expression kind');
    }
  }
  const functions=headers.map((f,i)=>({...f,body:node(sourceFunctions[i].body,i,0,f.returnType??'int')}));
  const color=new Uint8Array(headers.length);
  function visit(i) {
    if(color[i]===1)fail('recursive call graph unsupported pending fuel');
    if(color[i]===2)return;
    color[i]=1;for(const j of graph[i])visit(j);color[i]=2;
  }
  functions.forEach((_,i)=>visit(i));
  return {schemaVersion:PROGRAM_IR_VERSION,dialect:PROGRAM_IR_DIALECT,
    integerModel:PROGRAM_IR_INT_MODEL,sourceNamespace:namespace,
    modules:moduleNames,functions};
}
export function stringifyProgramIRV2(ir){
  return JSON.stringify(validateProgramIRV2(ir));
}
