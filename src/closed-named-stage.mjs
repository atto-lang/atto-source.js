// Separate, closed integer-only recursive body. No ordinary call target,
 // capture, host capability or user-controlled identifier enters its emitter.
export const NAMED_STAGE_DEPTH=1024;
const fail=message=>{throw new TypeError('E_NAMED_STAGE_PROFILE: '+message);};
const record=(v,keys)=>{
  if(!v||typeof v!=='object'||Array.isArray(v)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('expected plain body record');
  const own=Reflect.ownKeys(v);
  if(own.length!==keys.length||own.some(k=>!keys.includes(k)))fail('unexpected body fields');
  for(const k of keys)if(!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},'value'))fail('non-data body field');
};
const integer=v=>{
  if(typeof v!=='string'||v.length>20||!/^(?:0|-?[1-9][0-9]*)$/.test(v)||
      BigInt(v)<-(1n<<63n)||BigInt(v)>(1n<<63n)-1n)fail('invalid i64');
  return v;
};
export function validateNamedStageBody(body,charge=()=>{}){
  let count=0;
  function visit(e,depth){
    charge();
    if(++count>4096||depth>64)fail('body budget');
    if(!e||typeof e!=='object'||!Object.hasOwn(Object.getOwnPropertyDescriptor(e,'kind')??{},'value'))fail('invalid body kind');
    switch(e.kind){
      case 'int':record(e,['kind','value']);return {kind:'int',value:integer(e.value)};
      case 'stageArg':record(e,['kind']);return {kind:'stageArg'};
      case 'stageSelf':case 'neg':
        record(e,['kind','inner']);return {kind:e.kind,inner:visit(e.inner,depth+1)};
      case 'binary':
        record(e,['kind','op','left','right']);
        if(!['+','-','*','/'].includes(e.op))fail('invalid arithmetic operator');
        return {kind:'binary',op:e.op,left:visit(e.left,depth+1),right:visit(e.right,depth+1)};
      case 'match':{
        // At most one match frame per recursive activation; nested match
        // expressions require a verified execution-stack lowering.
        if(depth!==0)fail('nested match requires stack lowering');
        record(e,['kind','subject','arms']);
        const arms=e.arms;
        if(!Array.isArray(arms)||Object.getPrototypeOf(arms)!==Array.prototype||arms.length<1||arms.length>64||
            Reflect.ownKeys(arms).length!==arms.length+1)fail('invalid match arms');
        const subject=visit(e.subject,depth+1),seen=new Set();
        const copied=[];
        for(let i=0;i<arms.length;i++){
          const d=Object.getOwnPropertyDescriptor(arms,String(i));
          if(!Object.hasOwn(d??{},'value'))fail('non-data arm');
          const arm=d.value;
          record(arm,['value','body']);
          const value=arm.value===null?null:integer(arm.value);
          if(seen.has(value)||seen.has(null))fail('duplicate or unreachable arm');
          seen.add(value);
          copied.push({value,body:visit(arm.body,depth+1)});
        }
        if(!seen.has(null))fail('nonexhaustive match');
        return {kind:'match',subject,arms:copied};
      }
      default:fail('outside closed recursive body');
    }
  }
  return visit(body,0);
}
export function emitNamedStage(body,input){
  // Validate even when this helper is called outside the program IR emitter.
  // input is a compiler-produced expression, not a source string or IR field.
  const checked=validateNamedStageBody(body);
  const emit=e=>{
    switch(e.kind){
      case 'int':return e.value+'n';
      case 'stageArg':return '_arg';
      case 'stageSelf':return '_self('+emit(e.inner)+',_depth+1)';
      case 'neg':return '_check(-('+emit(e.inner)+'))';
      case 'binary':{
        const a=emit(e.left),b=emit(e.right);
        if(e.op==='/')return '((a,b)=>{if(b===0n)throw _arith("division_by_zero","ORES_I64_DIVISION_BY_ZERO");return _check(a/b);})('+a+','+b+')';
        return '_check(('+a+')'+e.op+'('+b+'))';
      }
      case 'match':return '(()=>{switch('+emit(e.subject)+'){'+e.arms.map(a=>
        (a.value===null?'default:':'case '+a.value+'n:')+'return '+emit(a.body)+';').join('')+'}})()';
    }
  };
  // Per-invocation depth, not a mutable module-global counter. Stack
  // exhaustion is not branded as a catchable ordinary arithmetic error.
  return '((input)=>{function _self(_arg,_depth){if(_depth>'+NAMED_STAGE_DEPTH+
    ')throw new RangeError("E_STACK: named stage logical depth exhausted");_check(_arg);return '+emit(checked)+
    ';}return _self(input,0);})('+input+')';
}
