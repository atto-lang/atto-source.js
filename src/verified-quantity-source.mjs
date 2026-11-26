// Closed and immutable typed signed-i64 profile. Reuse the production lexer and validated checked
// program-v2 emitter; do not route quantities through wrapping scalar-v1.
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n,LIMIT=(1n<<256n)-1n;
const scalar=()=>({powers:new Map(),n:1n,d:1n});
const FULL=[MIN,MAX],NARROW=[-(1n<<31n),(1n<<31n)-1n];
const max=(a,b)=>a>b?a:b,min=(a,b)=>a<b?a:b;
// A bounded exclusion domain: only 0 and -1 are represented as holes.
const bit=n=>n===0n?1:n===-1n?2:0;
const has=(r,n)=>r[0]<=n&&n<=r[1]&&!((r[2]??0)&bit(n));
function normalize(lo,hi,mask=0){
  if(lo>hi)return null;
  while(mask&bit(lo))lo++;
  while(mask&bit(hi))hi--;
  if(lo>hi)return null;
  return [lo,hi,mask];
}
const intersect=(a,b)=>normalize(max(a[0],b[0]),min(a[1],b[1]),(a[2]??0)|(b[2]??0));
const contains=(a,b)=>a[0]<=b[0]&&b[1]<=a[1]&&[0n,-1n].every(n=>!has(b,n)||has(a,n));
const join=(a,b)=>normalize(min(a[0],b[0]),max(a[1],b[1]),[0n,-1n].reduce((m,n)=>m|(!has(a,n)&&!has(b,n)?bit(n):0),0));
function restrict(r,op,n){
  if(op==='!='){
    if(!has(r,n))return r;
    if(r[0]===n)return normalize(n+1n,r[1],r[2])??r;
    if(r[1]===n)return normalize(r[0],n-1n,r[2])??r;
    return normalize(r[0],r[1],(r[2]??0)|bit(n))??r;
  }
  const bound=op==='<'?[MIN,n-1n]:op==='<='?[MIN,n]:op==='>'?[n+1n,MAX]:op==='>='?[n,MAX]:[n,n];
  return intersect(r,bound)??r; // no unreachable-path certification
}
const normal=(lo,hi)=>intersect([lo,hi],FULL)??FULL;
function arithmeticRange(a,b,op){
  const [l,h]=a,[r,s]=b;
  if(op==='+')return normal(l+r,h+s);
  if(op==='-')return normal(l-s,h-r);
  if(op==='/'&&r<=0n&&s>=0n)return FULL;
  const vs=op==='*'?[l*r,l*s,h*r,h*s]:[l/r,l/s,h/r,h/s];
  return normal(vs.reduce(min),vs.reduce(max));
}
const gcd=(a,b)=>{while(b){[a,b]=[b,a%b]}return a;};
function sameDimensions(a,b){return a.powers.size===b.powers.size&&[...a.powers].every(([k,v])=>b.powers.get(k)===v);}
function same(a,b){return sameDimensions(a,b)&&a.n===b.n&&a.d===b.d;}
function ratio(powers,n,d,fail){
  const g=gcd(n,d); n/=g;d/=g;
  if(n<1n||d<1n||n>LIMIT||d>LIMIT)fail('E_UNIT_LIMIT','normalized scale exceeds 256 bits');
  return {powers,n,d};
}
// Prove the operation itself, not merely the range after successful execution.
function provesArithmetic(a,b,op){
  const [l,h]=a,[r,s]=b;
  const fits=(lo,hi)=>lo>=MIN&&hi<=MAX;
  if(op==='+')return fits(l+r,h+s);
  if(op==='-')return fits(l-s,h-r);
  if(op==='*'){const v=[l*r,l*s,h*r,h*s];return fits(v.reduce(min),v.reduce(max));}
  if(op==='/')return !has(b,0n)&&!(has(a,MIN)&&has(b,-1n));
  return false;
}
export function lowerVerifiedQuantitySource(tokens,report,strict=false){
  const refinementEntry=tokens[0]?.value==='type'&&tokens[2]?.value==='='&&['int','i64','i32'].includes(tokens[3]?.value)&&tokens[4]?.value==='where';
  if(!refinementEntry&&(tokens[0]?.value!=='define'||!['dimension','unit'].includes(tokens[1]?.value)))return null;
  let at=0,budget=256;
  const peek=()=>tokens[Math.min(at,tokens.length-1)];
  const fail=(code,msg)=>report(code+': '+msg,peek());
  const take=v=>peek().value===v?(at++,true):false;
  const expect=v=>{if(!take(v))fail('E_SYNTAX','expected '+v);};
  const name=()=>{const t=peek();if(t.kind!=='id')fail('E_UNIT_NAME','expected name');at++;return t.value;};
  const dims=new Set(),bases=new Set(),units=new Map(),aliases=new Map(),signatures=new Map();
  let locals=new Map(),nextStrictSlot=0;
  const lookup=n=>{if(!units.has(n))fail('E_UNIT_NAME','unknown unit '+n);return units.get(n);};
  const integer=(negative=false)=>{
    const t=peek();if(t.kind!=='int')fail('E_SYNTAX','expected integer');
    at++;const v=BigInt(t.value.replaceAll('_',''))*(negative?-1n:1n);
    if(v<MIN||v>MAX)fail('E_UNIT_RANGE','integer out of range');
    return [t,v];
  };
  const factor=()=>{if(peek().kind!=='int')fail('E_UNIT_SCALE','positive signed-i64 scale required');const n=BigInt(peek().value.replaceAll('_',''));at++;if(n<=0n||n>MAX)fail('E_UNIT_SCALE','positive signed-i64 scale required');return n;};
  let declarations=0;
  while(take('define')){
    if(++declarations>128)fail('E_UNIT_LIMIT','too many declarations');
    const dimension=take('dimension');if(!dimension)expect('unit');
    const n=name();
    if(['int','i64','i32','float','bool','void','string','define','unit','dimension','main','return','as','fnc','pub'].includes(n))fail('E_RESERVED','reserved quantity name');
    if(dims.has(n)||units.has(n))fail('E_UNIT_DUPLICATE','duplicate quantity name');
    if(dimension){expect(';');dims.add(n);continue;}
    expect(':');const dim=name();
    if(!dims.has(dim))fail('E_UNIT_NAME','unknown dimension');
    const powers=new Map([[dim,1]]);
    let unit={powers,n:1n,d:1n};
    if(take('=')){
      let base,f=1n,divide=false;
      if(peek().kind==='int'||peek().value==='-'){f=factor();expect('*');base=lookup(name());}
      else {base=lookup(name());if(take('*'))f=factor();else if(take('/')){f=factor();divide=true;}}
      if(!sameDimensions(base,unit))fail('E_UNIT_DIMENSION','derived unit dimension mismatch');
      unit=ratio(powers,base.n*(divide?1n:f),base.d*(divide?f:1n),fail);
    }else{
      if(bases.has(dim))fail('E_UNIT_DUPLICATE','duplicate canonical unit');
      bases.add(dim);
    }
    expect(';');units.set(n,unit);
  }
  const identifier=()=>{
    const n=name();
    if(['int','i64','i32','float','bool','void','string','define','unit','dimension','type','return','as','fnc','pub','val','where','self','and','in','units','begin','end','requires','ensures'].includes(n))
      fail('E_RESERVED','reserved identifier');
    return n;
  };
  const type=()=>{
    const n=name();
    if(n==='int'||n==='i64')return {unit:scalar(),range:FULL,width:64};
    if(n==='i32')return {unit:scalar(),range:NARROW,width:32};
    if(!aliases.has(n))fail('E_UNIT_NAME','unknown refinement type');
    return aliases.get(n);
  };
  const compatible=(want,got)=>{
    if(!sameDimensions(want,got))fail('E_UNIT_DIMENSION','incompatible dimensions');
    if(!same(want,got))fail('E_UNIT_SCALE','incompatible scale');
  };
  const boundary=(want,got,code)=>{
    compatible(want.unit,got.unit);
    if(!contains(want.range,got.range))fail(code,'unproved refinement on normal result');
  };
  while(take('type')){
    if(aliases.size>=128)fail('E_UNIT_LIMIT','too many aliases');
    if(['int','i64','i32'].includes(peek().value))fail('E_REFINEMENT_DUPLICATE','reserved carrier');
    const n=identifier();
    if(aliases.has(n)||dims.has(n)||units.has(n))fail('E_UNIT_DUPLICATE','duplicate alias');
    expect('=');const carrier=name();if(!['int','i64','i32'].includes(carrier))fail('E_REFINEMENT_BOUND','unsupported carrier');expect('where');
    const width=carrier==='i32'?32:64;
    let unit=null,range=width===32?NARROW:FULL;
    do{
      if(take('units')){
        if(unit!==null)fail('E_UNIT_DUPLICATE','duplicate unit clause');
        expect('in');unit=lookup(name());
      }else{
        expect('self');const op=peek().value;at++;
        if(!['>','>=','<','<=','eq','==','gte','lte'].includes(op))fail('E_REFINEMENT_BOUND','unsupported predicate');
        const [,v]=integer(take('-'));
        const bound=op==='>'?[v+1n,MAX]:op==='<'?[MIN,v-1n]:op==='>='||op==='gte'?[v,MAX]:op==='<='||op==='lte'?[MIN,v]:[v,v];
        range=intersect(range,bound);
        if(range===null)fail('E_REFINEMENT_EMPTY','contradictory refinement');
      }
    }while(take('and'));
    expect(';');aliases.set(n,{unit:unit??scalar(),range,width});
  }
  if(strict&&!aliases.size)fail('E_VERIFY_UNSUPPORTED','strict profile requires typed quantity aliases');
  const make=(unit,ir,literal=null,range=literal===null?FULL:[literal,literal],width=literal===null?64:0)=>({unit,ir,literal,range,width});
  function checkedWidth(v,width){
    if(width!==32)return {...v,width};
    if(strict&&!contains(NARROW,v.range))fail('E_VERIFY_UNPROVEN','i32 operation may overflow');
    return make(v.unit,{kind:'i32Check',inner:v.ir},null,intersect(v.range,NARROW)??NARROW,32);
  }
  const int=v=>({kind:'int',value:String(v)});
  function attach(value,target){
    if(!same(value.unit,scalar()))fail('E_UNIT_ATTACHMENT','attachment requires dimensionless scale one');
    return {...value,unit:lookup(target)};
  }
  function cast(value,target,legacy){
    if(aliases.has(target)){
      const want=aliases.get(target);
      compatible(want.unit,value.unit);
      if(strict&&!contains(want.range,value.range))fail('E_VERIFY_UNPROVEN','refinement cast may fail');
      return make(want.unit,{kind:'refinementCheck',inner:value.ir,minimum:String(want.range[0]),maximum:String(want.range[1])},null,intersect(value.range,want.range)??want.range,want.width);
    }
    if(legacy&&units.has(target))return attach(value,target);
    if(!['int','i64'].includes(target))fail('E_UNSUPPORTED_CAST','only signed-i64 identity casts in closed quantities');
    if(!same(value.unit,scalar()))fail('E_UNIT_ERASURE','scalar cast cannot erase units');
    return {...value,width:64};
  }
  function combine(a,b,divide){
    const powers=new Map(a.powers);
    for(const [k,v] of b.powers){
      const next=(powers.get(k)??0)+(divide?-v:v);
      if(Math.abs(next)>64)fail('E_UNIT_LIMIT','dimension exponent exceeds 64');
      if(next===0)powers.delete(k);else powers.set(k,next);
    }
    if(powers.size>32)fail('E_UNIT_LIMIT','too many dimensions');
    return ratio(powers,a.n*(divide?b.d:b.n),a.d*(divide?b.n:b.d),fail);
  }
  function convert(v,target){
    if(v.literal===null)fail('E_UNSUPPORTED','conversion restricted to literals');
    if(!sameDimensions(v.unit,target))fail('E_UNIT_DIMENSION','conversion dimension mismatch');
    const n=v.literal*v.unit.n*target.d,d=v.unit.d*target.n;
    if(n%d!==0n)fail('E_UNIT_INEXACT','nonintegral conversion');
    const result=n/d;
    if(result<MIN||result>MAX)fail('E_UNIT_RANGE','conversion out of range');
    return make(target,int(result),result,undefined,v.width);
  }
  function postfix(v,depth){
    while(peek().value==='::'||(peek().value==='.'&&tokens[at+1]?.value==='<')){
      if(--budget<0)fail('E_UNIT_LIMIT','postfix budget exceeded');
      const unitOnly=take('.');if(!unitOnly)expect('::');
      expect('<');const target=name();expect('>');
      v=unitOnly?attach(v,target):cast(v,target,true);
    }
    if(peek().value==='.'&&tokens[at+1]?.value==='to_unit'){
      expect('.');expect('to_unit');expect('<');const target=lookup(name());expect('>');expect('(');expect(')');
      v=convert(v,target);
    }
    return v;
  }
  function atom(depth){
    if(depth>48||--budget<0)fail('E_UNIT_LIMIT','expression budget exceeded');
    if(take('<')){const target=name();expect('>');return cast(atom(depth+1),target,false);}
    if(take('+'))return atom(depth+1);
    if(take('-')){
      if(peek().kind==='int'&&BigInt(peek().value.replaceAll('_',''))===-MIN)return literal(true,depth);
      const v=atom(depth+1);
      if(strict&&v.range[0]===MIN)fail('E_VERIFY_UNPROVEN','signed negation may overflow');
      return checkedWidth(make(v.unit,{kind:'neg',inner:v.ir},null,normal(-v.range[1],-v.range[0])),v.width);
    }
    if(take('(')){const v=expr(0,depth+1);expect(')');return postfix({...v,literal:null},depth);}
    if(peek().kind==='id'){
      const n=identifier();
      if(take('(')){
        if(!signatures.has(n))fail('E_REFINEMENT_CALL','unknown or forward private function');
        const sig=signatures.get(n),args=[];
        for(const want of sig.params){
          if(args.length)expect(',');
          if(peek().value===')')fail('E_REFINEMENT_CALL','missing argument');
          const arg=expr(0,depth+1);boundary(want,arg,'E_REFINEMENT_PRECONDITION');args.push(arg.ir);
        }
        if(!take(')'))fail('E_REFINEMENT_CALL','arity mismatch');
        return postfix(make(sig.result.unit,{kind:'call',target:sig.index,args},null,sig.result.range,sig.result.width),depth);
      }
      if(!locals.has(n))fail('E_UNIT_NAME','unknown binding');
      const binding=locals.get(n);
      if(binding.cells){
        if(!take('['))fail('E_VERIFY_UNSUPPORTED','array cannot escape or be used as scalar');
        const index=expr(0,depth+1);expect(']');compatible(index.unit,scalar());
        const [lo,hi]=index.range;
        if(lo<0n||hi>=BigInt(binding.cells.length))fail('E_VERIFY_UNPROVEN','index not proved within receiver bounds');
        if(!['capture','param','int'].includes(index.ir.kind))fail('E_VERIFY_UNSUPPORTED','fixed index requires scalar local or literal');
        let ir=binding.cells[Number(hi)].ir,range=binding.cells[Number(hi)].range;
        for(let i=hi-1n;i>=lo;i--){
          const cell=binding.cells[Number(i)];
          ir={kind:'if',condition:{kind:'compare',op:'==',left:index.ir,right:int(i)},yes:cell.ir,no:ir};
          range=join(range,cell.range);
        }
        return postfix(make(scalar(),ir,null,range,64),depth);
      }
      return postfix({...binding},depth);
    }
    return literal(false,depth);
  }
  function literal(negative,depth){
    const [t,v]=integer(negative);let unit=scalar();
    if(peek().value==='<'&&peek().line===t.line&&peek().col===t.col+t.value.length){
      expect('<');unit=lookup(name());expect('>');
    }
    return postfix(make(unit,int(v),v),depth);
  }
  function expr(min,depth){
    let left=atom(depth);
    for(;;){
      const op=peek().value,prec=op==='+'||op==='-'?1:op==='*'||op==='/'?2:0;
      if(prec<=min)break;
      at++;const right=expr(prec,depth+1);let unit;
      if(op==='+'||op==='-'){
        if(!sameDimensions(left.unit,right.unit))fail('E_UNIT_DIMENSION','mixed dimensions');
        if(!same(left.unit,right.unit))fail('E_UNIT_SCALE','mixed scales');
        unit=left.unit;
      }else{
        if(!strict&&!aliases.size&&op==='/'&&same(left.unit,scalar())&&same(right.unit,scalar()))fail('E_UNIT_SCALAR_DIVISION','plain scalar division outside quantity profile');
        unit=combine(left.unit,right.unit,op==='/');
      }
      if(strict&&!provesArithmetic(left.range,right.range,op))fail('E_VERIFY_UNPROVEN','signed arithmetic may overflow or divide by zero');
      const width=left.width===64||right.width===64?64:left.width===32||right.width===32?32:64;
      if(width===32&&[left,right].some(v=>v.width===0&&!contains(NARROW,v.range)))fail('E_I32_RANGE','literal operand outside i32');
      left=checkedWidth(make(unit,{kind:'binary',op,left:left.ir,right:right.ir},null,arithmeticRange(left.range,right.range,op)),width);
    }
    while(min===0&&take('as')){if(take('?'))fail('E_REFINEMENT_CAST','optional casts not admitted');left=cast(left,name(),true);}
    return left;
  }
  function joinFacts(a,b){
    return new Map([...a].map(([k,v])=>[k,{...v,range:join(v.range,b.get(k).range)}]));
  }
  function condition(incoming,depth=0){
    if(depth>16||--budget<0)fail('E_UNIT_LIMIT','strict condition budget');
    function predicate(facts,d){
      if(d>16||--budget<0)fail('E_UNIT_LIMIT','strict predicate budget');
      locals=facts;
      if(take('!')){
        const p=predicate(facts,d+1);
        return {ir:{kind:'not',inner:p.ir},yes:p.no,no:p.yes};
      }
      if(take('(')){
        const p=disjunction(facts,d+1);expect(')');return p;
      }
      const left=expr(0,0);
      const op=({'eq':'==','neq':'!='})[peek().value]??peek().value;
      if(!['<','<=','>','>=','==','!='].includes(op))fail('E_VERIFY_UNSUPPORTED','strict comparison required');
      at++;
      const right=expr(0,0);compatible(left.unit,right.unit);
      const yes=new Map(facts),no=new Map(facts);
      const inverse={'<':'>=','<=':'>','>':'<=','>=':'<','==':'!=','!=':'=='};
      if(right.range[0]===right.range[1]){
        // Only the exact original immutable binding can be narrowed.
        for(const [key,v] of facts)if(left.ir===v.ir){
          const edge=(cmp)=>{
            const n=right.range[0];
            // A contradictory singleton on a split path cannot execute its
            // inequality edge. Use only the representable guard domain there,
            // not an unchecked/bottom proof of arbitrary expressions.
            if(cmp==='!='&&bit(n)&&v.range[0]===n&&v.range[1]===n){
              const domain=v.width===32?NARROW:FULL;
              return normalize(domain[0],domain[1],bit(n));
            }
            return restrict(v.range,cmp,n);
          };
          yes.set(key,{...v,range:edge(op)});
          no.set(key,{...v,range:edge(inverse[op])});
        }
      }
      return {ir:{kind:'compare',op,left:left.ir,right:right.ir},yes,no};
    }
    function conjunction(facts,d){
      let p=predicate(facts,d);
      while(take('and')){
        const q=predicate(p.yes,d);
        p={ir:{kind:'if',condition:p.ir,yes:q.ir,no:{kind:'bool',value:false}},yes:q.yes,no:joinFacts(p.no,q.no)};
      }
      return p;
    }
    function disjunction(facts,d){
      let p=conjunction(facts,d);
      while(take('or')){
        const q=conjunction(p.no,d);
        p={ir:{kind:'if',condition:p.ir,yes:{kind:'bool',value:true},no:q.ir},yes:joinFacts(p.yes,q.yes),no:q.no};
      }
      return p;
    }
    return disjunction(incoming,depth);
  }
  // Closed scalar control flow with fresh lexical SSA-like versions, bounded
  // path-sensitive continuation splitting and single-state iterative while.
  // No aliases, nonlocal mutation, effects or suspension are admitted.
  function loopPlan(facts,mutable,depth,top){
    if(depth>16||--budget<0)fail('E_UNIT_LIMIT','strict loop budget');
    let brace=at;
    while(brace<tokens.length&&tokens[brace].value!=='{'&&tokens[brace].kind!=='eof')brace++;
    if(tokens[brace]?.value!=='{')fail('E_VERIFY_UNSUPPORTED','loop block required');
    const writes=new Set();let nesting=1;
    for(let k=brace+1;k<tokens.length&&nesting;k++){
      const t=tokens[k];
      if(t.value==='{')nesting++;
      else if(t.value==='}')nesting--;
      else if(t.kind==='id'&&tokens[k+1]?.value==='='&&mutable.has(t.value))writes.add(t.value);
    }
    if(nesting)fail('E_VERIFY_UNSUPPORTED','unterminated loop');
    const header=new Map(facts),states=[];
    for(const key of writes){
      const want=mutable.get(key),initial=facts.get(key);
      boundary(want,initial,'E_REFINEMENT_BINDING');
      let ir=initial.ir;
      if(top){
        if(nextStrictSlot>=64)fail('E_UNIT_LIMIT','strict local slot budget');
        const slot=nextStrictSlot++;states.push({slot,init:ir});ir={kind:'capture',slot};
      }
      if(ir.kind!=='capture')fail('E_VERIFY_UNSUPPORTED','loop target must have a scalar slot');
      header.set(key,make(want.unit,ir,null,want.range,want.width));
    }
    const p=condition(header);
    expect('{');
    let current=new Map(p.yes);const declared=new Map(mutable),steps=[];
    while(!take('}')){
      if(--budget<0)fail('E_UNIT_LIMIT','strict loop statement budget');
      locals=current;
      if(take('while')){
        const nested=loopPlan(current,declared,depth+1,false);
        steps.push({kind:'loop',condition:nested.condition,steps:nested.steps});
        current=nested.exit;continue;
      }
      if(peek().value==='let'||peek().value==='val'){
        const mut=take('let');if(!mut)expect('val');
        let key,want=null;
        if(tokens[at+1]?.value===':'){key=identifier();expect(':');want=type();}
        else if(tokens[at+1]?.value==='='){key=identifier();}
        else{want=type();key=identifier();}
        if(mut&&!want)fail('E_VERIFY_UNSUPPORTED','mutable loop local requires declared type');
        if(current.has(key))fail('E_UNIT_DUPLICATE','duplicate loop local');
        if(peek().value===';')fail('E_MISSING_INITIALIZER','explicit initializer required');
        expect('=');const value=expr(0,0);expect(';');
        if(want)boundary(want,value,'E_REFINEMENT_BINDING');
        if(nextStrictSlot>=64)fail('E_UNIT_LIMIT','strict local slot budget');
        const slot=nextStrictSlot++;
        current.set(key,make(value.unit,{kind:'capture',slot},null,value.range,want?.width??(value.width||64)));
        if(mut)declared.set(key,want);
        steps.push({kind:'bind',slot,mutable:mut,init:value.ir});continue;
      }
      if(peek().kind==='id'&&tokens[at+1]?.value==='='){
        const key=identifier();expect('=');
        const want=declared.get(key),prior=current.get(key);
        if(!want||prior?.ir.kind!=='capture')fail('E_VERIFY_UNSUPPORTED','assignment to nonmutable loop slot');
        const value=expr(0,0);expect(';');boundary(want,value,'E_REFINEMENT_BINDING');
        steps.push({kind:'set',slot:prior.ir.slot,value:value.ir});
        current.set(key,make(want.unit,prior.ir,null,value.range,want.width));continue;
      }
      fail('E_VERIFY_UNSUPPORTED','strict loop statement not admitted');
    }
    for(const key of writes)boundary(mutable.get(key),current.get(key),'E_REFINEMENT_BINDING');
    return {states,condition:p.ir,steps,exit:p.no};
  }
  // Fixed, nonescaping scalar arrays are scalar-replaced into immutable
  // captures. Every initializer is evaluated exactly once, in source order.
  function readFixedArray(key,allocate){
    expect('Array');expect('.');expect('of');expect('(');
    const cells=[],inits=[];
    do{
      if(cells.length>=16)fail('E_UNIT_LIMIT','fixed array cell budget');
      const v=expr(0,0);compatible(scalar(),v.unit);
      const slot=allocate();inits.push({slot,init:v.ir});
      cells.push(make(scalar(),{kind:'capture',slot},null,v.range,64));
    }while(take(','));
    expect(')');expect(';');
    const range=cells.map(c=>c.range).reduce(join);
    return {binding:{...make(scalar(),{kind:'array-marker',key},null,range,64),cells},inits};
  }
  function strictReturn(result,facts,mutable=new Map(),depth=0,onExit=null){
    if(depth>16||--budget<0)fail('E_UNIT_LIMIT','strict return budget');
    locals=facts;
    if(peek().value==='}'&&onExit)return onExit(facts,mutable,depth);
    if(take('while')){
      const p=loopPlan(facts,mutable,depth,true);
      return {kind:'scalarWhileMany',states:p.states,condition:p.condition,steps:p.steps,
        body:strictReturn(result,p.exit,mutable,depth+1,onExit)};
    }
    if(['loop','for','break','continue'].includes(peek().value))
      fail('E_VERIFY_UNSUPPORTED','strict loop form not implemented');
    if(peek().value==='let'||peek().value==='val'){
      const isMutable=take('let');if(!isMutable)expect('val');
      let key,want=null;
      if(tokens[at+1]?.value===':'){key=identifier();expect(':');want=type();}
      else if(tokens[at+1]?.value==='='){key=identifier();}
      else{want=type();key=identifier();}
      if(isMutable&&want===null)fail('E_VERIFY_UNSUPPORTED','strict mutable scalar requires declared type');
      if(facts.has(key))fail('E_UNIT_DUPLICATE','duplicate local');
        if(peek().value===';')fail('E_MISSING_INITIALIZER','explicit initializer required');
      expect('=');
      if(peek().value==='Array'){
        if(isMutable||want!==null||onExit)fail('E_VERIFY_UNSUPPORTED','fixed array requires nonescaping inferred val');
        const p=readFixedArray(key,()=>{if(nextStrictSlot>=64)fail('E_UNIT_LIMIT','strict local slot budget');return nextStrictSlot++;});
        const after=new Map(facts);after.set(key,p.binding);
        let tail=strictReturn(result,after,mutable,depth+1,onExit);
        for(let i=p.inits.length-1;i>=0;i--)tail={kind:'local',...p.inits[i],body:tail};
        return tail;
      }
      const value=expr(0,0);expect(';');
      if(want!==null)boundary(want,value,'E_REFINEMENT_BINDING');
      if(nextStrictSlot>=64)fail('E_UNIT_LIMIT','strict local slot budget');
      const slot=nextStrictSlot++,after=new Map(facts),decls=new Map(mutable);
      after.set(key,make(value.unit,{kind:'capture',slot},null,value.range,want?.width??(value.width||64)));
      if(isMutable)decls.set(key,want);
      return {kind:'local',slot,init:value.ir,body:strictReturn(result,after,decls,depth+1,onExit)};
    }
    if(peek().kind==='id'&&tokens[at+1]?.value==='='){
      const key=identifier();expect('=');
      if(!mutable.has(key))fail('E_VERIFY_UNSUPPORTED','assignment to nonmutable binding');
      const value=expr(0,0);expect(';');
      boundary(mutable.get(key),value,'E_REFINEMENT_BINDING');
      if(nextStrictSlot>=64)fail('E_UNIT_LIMIT','strict local slot budget');
      const slot=nextStrictSlot++,after=new Map(facts);
      // New binding identity and replacement range, never union with stale fact.
      after.set(key,make(value.unit,{kind:'capture',slot},null,value.range,mutable.get(key).width));
      return {kind:'local',slot,init:value.ir,body:strictReturn(result,after,mutable,depth+1,onExit)};
    }
    if(take('if')){
      const p=condition(facts);
      // Bounded continuation splitting: each continuing arm independently
      // checks the remaining source under its own current SSA versions.
      // The generated conditional executes exactly one arm and continuation.
      const close=(open)=>{
        if(tokens[open]?.value!=='{')fail('E_SYNTAX','expected branch block');
        let nesting=0;
        for(let k=open;k<tokens.length;k++){
          if(tokens[k].value==='{')nesting++;
          else if(tokens[k].value==='}'&&--nesting===0)return k;
        }
        fail('E_SYNTAX','unterminated strict branch');
      };
      const yesOpen=at,yesClose=close(yesOpen);
      const hasElse=tokens[yesClose+1]?.value==='else';
      const noOpen=yesClose+2,noClose=hasElse?close(noOpen):yesClose;
      const resume=noClose+1;
      let end=null;
      const continuation=(edgeFacts,edgeMutable,d)=>{
        const saved=at;
        const scoped=new Map([...facts.keys()].map(k=>[k,edgeFacts.get(k)]));
        // Locals declared inside an arm never enter the outer scope.
        at=resume;
        const tail=strictReturn(result,scoped,mutable,d+1,onExit);
        if(end!==null&&end!==at)fail('E_VERIFY_UNSUPPORTED','inconsistent branch continuation');
        end=at;at=saved;
        return tail;
      };
      at=yesOpen+1;
      const yes=strictReturn(result,p.yes,mutable,depth+1,continuation);
      if(at!==yesClose)fail('E_VERIFY_UNSUPPORTED','statement after strict return');
      let no;
      if(hasElse){
        at=noOpen+1;
        no=strictReturn(result,p.no,mutable,depth+1,continuation);
        if(at!==noClose)fail('E_VERIFY_UNSUPPORTED','statement after strict return');
      }else{
        at=resume;
        no=strictReturn(result,p.no,mutable,depth+1,onExit);
        if(end!==null&&end!==at)fail('E_VERIFY_UNSUPPORTED','inconsistent branch continuation');
        end=at;
      }
      at=end??resume;
      return {kind:'if',condition:p.ir,yes,no};
    }
    expect('return');const v=expr(0,0);expect(';');
    boundary(result,v,'E_REFINEMENT_RETURN');
    return v.ir;
  }
  function readContracts(params,types,result,pub){
    const checks=[];let count=0;
    const cmp=()=>{const op=({'eq':'==','gte':'>=','lte':'<='})[peek().value]??peek().value;
      if(!['==','<','<=','>','>='].includes(op))fail('E_REFINEMENT_CONTRACT','expected comparison');at++;return op;};
    const bound=want=>{
      const [,n]=integer(take('-'));let u=scalar();
      const dot=take('.');
      if(dot||peek().value==='<'){expect('<');u=lookup(name());expect('>');}
      compatible(want.unit,u);return n;
    };
    while(['requires','ensures'].includes(peek().value)){
      if(pub||++count>16)fail('E_REFINEMENT_CONTRACT','contract budget or entrypoint');
      const require=take('requires');if(!require)expect('ensures');
      const key=name(),op=cmp();
      if(require){
        const i=params.indexOf(key);if(i<0)fail('E_REFINEMENT_CONTRACT','unknown parameter');
        const p=types[i],n=bound(p);
        const b=op==='<'?[MIN,n-1n]:op==='<='?[MIN,n]:op==='>'?[n+1n,MAX]:op==='>='?[n,MAX]:[n,n];
        const range=intersect(p.range,b);if(!range)fail('E_REFINEMENT_EMPTY','contradictory requires');
        types[i]={...p,range};locals.set(key,{...locals.get(key),range});
      }else{
        if(key!=='result')fail('E_REFINEMENT_CONTRACT','ensures must constrain result');
        if(peek().kind==='id'){
          const i=params.indexOf(name());if(i<0)fail('E_REFINEMENT_CONTRACT','unknown parameter');
          compatible(result.unit,types[i].unit);checks.push({op,param:i});
        }else checks.push({op,n:bound(result)});
      }
    }
    return checks;
  }
  // Prove only identity, checked casts, positive division and already
  // established earlier helper postconditions. Never sample a caller.
  function provesRelation(ir,param,nonnegative,bindings,depth=0){
    if(depth>=64)return false;
    const sub=e=>provesRelation(e,param,nonnegative,bindings,depth+1);
    if(ir.kind==='param')return ir.index===param;
    if(ir.kind==='capture')return !!bindings[ir.slot]&&sub(bindings[ir.slot].init);
    if(ir.kind==='refinementCheck'||ir.kind==='i32Check')return sub(ir.inner);
    if(ir.kind==='binary'&&ir.op==='/'&&nonnegative&&ir.right.kind==='int'&&BigInt(ir.right.value)>=1n)return sub(ir.left);
    if(ir.kind==='call'){
      const sig=[...signatures.values()].find(s=>s.index===ir.target);
      return !!sig&&sig.checks.some(c=>c.op==='<='&&c.param!==undefined&&sub(ir.args[c.param]));
    }
    return false;
  }
  function proveContracts(checks,value,types,bindings){
    const [lo,hi]=value.range;
    for(const c of checks){
      let yes=false;
      if(c.n!==undefined){const n=c.n;yes=c.op==='=='?lo===n&&hi===n:c.op==='<'?hi<n:c.op==='<='?hi<=n:c.op==='>'?lo>n:lo>=n;}
      else{
        const [a,b]=types[c.param].range;
        yes=c.op==='=='?lo===hi&&a===b&&lo===a:c.op==='<'?hi<a:c.op==='<='?hi<=a||provesRelation(value.ir,c.param,a>=0n,bindings):c.op==='>'?lo>b:lo>=b;
      }
      if(!yes)fail('E_REFINEMENT_POSTCONDITION','unproved ensures');
    }
  }
  const functions=[];
  for(;;){
    if(functions.length>=32)fail('E_UNIT_LIMIT','too many functions');
    const pub=take('pub');expect('fnc');const n=identifier();
    if(pub&&n!=='main'&&aliases.size)fail('E_REFINEMENT_EXPORT','private refinement helper required');
    if(pub!==(n==='main')||signatures.has(n)||aliases.has(n)||units.has(n)||dims.has(n))fail('E_UNIT_NAME','invalid function name or visibility');
    if(!aliases.size&&!pub)fail('E_UNSUPPORTED','closed profile admits only main');
    locals=new Map();const params=[],types=[];
    expect('(');
    if(!take(')')){
      do{
        if(params.length>=16)fail('E_UNIT_LIMIT','too many parameters');
        const want=type(),p=identifier();
        if(locals.has(p))fail('E_UNIT_DUPLICATE','duplicate parameter');
        locals.set(p,make(want.unit,{kind:'param',index:params.length},null,want.range,want.width));
        params.push(p);types.push(want);
      }while(take(','));
      expect(')');
    }
    expect('->');const result=type();
    if(pub&&(params.length||!same(result.unit,scalar())||!contains(result.range,FULL)))fail('E_UNIT_ERASURE','main requires zero arguments and plain int result');
    const contractStart=at,checks=readContracts(params,types,result,pub);
    const contracted=at!==contractStart;
    let closer='}';
    if(!take('{')){
      if(take('::'))closer='end';
      else if(peek().value==='begin'){
        if(contracted&&peek().line<=tokens[at-1].line)fail('E_SYNTAX','contracted begin must start on a later line');
        expect('begin');closer='end';
      }else fail('E_SYNTAX','expected verified callable body opener');
    }
    const bindings=[];
    while(take('val')){
      if(!aliases.size||bindings.length>=64)fail('E_UNIT_LIMIT','typed local admission or budget');
      let key,want=null;
      if(tokens[at+1]?.value===':'){key=identifier();expect(':');want=type();}
      else if(tokens[at+1]?.value==='='){key=identifier();}
      else{want=type();key=identifier();}
      if(locals.has(key))fail('E_UNIT_DUPLICATE','duplicate local');
        if(strict&&peek().value===';')fail('E_MISSING_INITIALIZER','explicit initializer required');
      expect('=');
      if(strict&&peek().value==='Array'){
        if(want!==null)fail('E_VERIFY_UNSUPPORTED','fixed array requires inferred val');
        let next=bindings.length;
        const p=readFixedArray(key,()=>{if(next>=64)fail('E_UNIT_LIMIT','strict local slot budget');return next++;});
        bindings.push(...p.inits);locals.set(key,p.binding);continue;
      }
      const value=expr(0,0);expect(';');
      if(want!==null)boundary(want,value,'E_REFINEMENT_BINDING');
      const slot=bindings.length;
      bindings.push({slot,init:value.ir});
      locals.set(key,make(value.unit,{kind:'capture',slot},null,value.range,want?.width??(value.width||64)));
    }
    let body;
    if(strict){if(checks.length)fail('E_VERIFY_UNSUPPORTED','strict ensures with control flow require separate proof');nextStrictSlot=bindings.length;body=strictReturn(result,locals);expect(closer);}
    else {
      if(peek().value==='let')fail('E_REFINEMENT_BODY','mutable binding not admitted');
      expect('return');const v=expr(0,0);expect(';');expect(closer);
      if(pub&&!same(v.unit,scalar()))fail('E_UNIT_ERASURE','main requires scale-one scalar');
      boundary(result,v,'E_REFINEMENT_RETURN');
      proveContracts(checks,v,types,bindings);
      body=v.ir;
    }
    for(let i=bindings.length-1;i>=0;i--)body={kind:'local',...bindings[i],body};
    const index=functions.length;
    functions.push({module:null,name:n,kind:'fnc',pub,params,body});
    if(pub){
      if(peek().kind!=='eof')fail('E_SYNTAX','unexpected trailing source');
      return {sourceNamespace:null,modules:[],functions};
    }
    signatures.set(n,{index,params:types,result,checks});
  }
}
