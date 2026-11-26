// Closed and immutable typed signed-i64 profile. Reuse the production lexer and validated checked
// program-v2 emitter; do not route quantities through wrapping scalar-v1.
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n,LIMIT=(1n<<256n)-1n;
const scalar=()=>({powers:new Map(),n:1n,d:1n});
const FULL=[MIN,MAX];
const max=(a,b)=>a>b?a:b,min=(a,b)=>a<b?a:b;
const intersect=(a,b)=>{const lo=max(a[0],b[0]),hi=min(a[1],b[1]);return lo<=hi?[lo,hi]:null;};
const contains=(a,b)=>a[0]<=b[0]&&b[1]<=a[1];
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
  if(op==='/')return (r>0n||s<0n)&&!(l===MIN&&r<=-1n&&s>=-1n);
  return false;
}
export function lowerVerifiedQuantitySource(tokens,report,strict=false){
  if(tokens[0]?.value!=='define'||!['dimension','unit'].includes(tokens[1]?.value))return null;
  let at=0,budget=256;
  const peek=()=>tokens[Math.min(at,tokens.length-1)];
  const fail=(code,msg)=>report(code+': '+msg,peek());
  const take=v=>peek().value===v?(at++,true):false;
  const expect=v=>{if(!take(v))fail('E_SYNTAX','expected '+v);};
  const name=()=>{const t=peek();if(t.kind!=='id')fail('E_UNIT_NAME','expected name');at++;return t.value;};
  const dims=new Set(),bases=new Set(),units=new Map(),aliases=new Map(),signatures=new Map();
  let locals=new Map();
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
    if(n==='int'||n==='i64')return {unit:scalar(),range:FULL};
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
    const n=identifier();
    if(aliases.has(n)||dims.has(n)||units.has(n))fail('E_UNIT_DUPLICATE','duplicate alias');
    expect('=');expect('int');expect('where');
    let unit=null,range=FULL;
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
    expect(';');aliases.set(n,{unit:unit??scalar(),range});
  }
  if(strict&&!aliases.size)fail('E_VERIFY_UNSUPPORTED','strict profile requires typed quantity aliases');
  const make=(unit,ir,literal=null,range=literal===null?FULL:[literal,literal])=>({unit,ir,literal,range});
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
      return make(want.unit,{kind:'refinementCheck',inner:value.ir,minimum:String(want.range[0]),maximum:String(want.range[1])},null,intersect(value.range,want.range)??want.range);
    }
    if(legacy&&units.has(target))return attach(value,target);
    if(!['int','i64'].includes(target))fail('E_UNSUPPORTED_CAST','only signed-i64 identity casts in closed quantities');
    if(!same(value.unit,scalar()))fail('E_UNIT_ERASURE','scalar cast cannot erase units');
    return value;
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
    return make(target,int(result),result);
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
      return make(v.unit,{kind:'neg',inner:v.ir},null,normal(-v.range[1],-v.range[0]));
    }
    if(take('(')){const v=expr(0,depth+1);expect(')');return postfix({...v,literal:null},depth);}
    if(peek().kind==='id'){
      const n=identifier();
      if(take('(')){
        if(!signatures.has(n))fail('E_UNIT_NAME','unknown or forward private function');
        const sig=signatures.get(n),args=[];
        for(const want of sig.params){
          if(args.length)expect(',');
          const arg=expr(0,depth+1);boundary(want,arg,'E_REFINEMENT_PRECONDITION');args.push(arg.ir);
        }
        expect(')');
        return postfix(make(sig.result.unit,{kind:'call',target:sig.index,args},null,sig.result.range),depth);
      }
      if(!locals.has(n))fail('E_UNIT_NAME','unknown binding');
      return postfix({...locals.get(n)},depth);
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
        if(!strict&&op==='/'&&same(left.unit,scalar())&&same(right.unit,scalar()))fail('E_UNIT_SCALAR_DIVISION','plain scalar division outside quantity profile');
        unit=combine(left.unit,right.unit,op==='/');
      }
      if(strict&&!provesArithmetic(left.range,right.range,op))fail('E_VERIFY_UNPROVEN','signed arithmetic may overflow or divide by zero');
      left=make(unit,{kind:'binary',op,left:left.ir,right:right.ir},null,arithmeticRange(left.range,right.range,op));
    }
    if(min===0&&take('as'))left=cast(left,name(),true);
    return left;
  }
  const functions=[];
  for(;;){
    if(functions.length>=32)fail('E_UNIT_LIMIT','too many functions');
    const pub=take('pub');expect('fnc');const n=identifier();
    if(pub!==(n==='main')||signatures.has(n)||aliases.has(n)||units.has(n)||dims.has(n))fail('E_UNIT_NAME','invalid function name or visibility');
    if(!aliases.size&&!pub)fail('E_UNSUPPORTED','closed profile admits only main');
    locals=new Map();const params=[],types=[];
    expect('(');
    if(!take(')')){
      do{
        if(params.length>=16)fail('E_UNIT_LIMIT','too many parameters');
        const want=type(),p=identifier();
        if(locals.has(p))fail('E_UNIT_DUPLICATE','duplicate parameter');
        locals.set(p,make(want.unit,{kind:'param',index:params.length},null,want.range));
        params.push(p);types.push(want);
      }while(take(','));
      expect(')');
    }
    expect('->');const result=type();
    if(pub&&(params.length||!same(result.unit,scalar())||!contains(result.range,FULL)))fail('E_UNIT_ERASURE','main requires zero arguments and plain int result');
    expect('{');
    const bindings=[];
    while(take('val')){
      if(!aliases.size||bindings.length>=64)fail('E_UNIT_LIMIT','typed local admission or budget');
      let key,want=null;
      if(tokens[at+1]?.value===':'){key=identifier();expect(':');want=type();}
      else if(tokens[at+1]?.value==='='){key=identifier();}
      else{want=type();key=identifier();}
      if(locals.has(key))fail('E_UNIT_DUPLICATE','duplicate local');
      expect('=');const value=expr(0,0);expect(';');
      if(want!==null)boundary(want,value,'E_REFINEMENT_BINDING');
      const slot=bindings.length;
      bindings.push({slot,init:value.ir});
      locals.set(key,make(value.unit,{kind:'capture',slot},null,value.range));
    }
    expect('return');const v=expr(0,0);expect(';');expect('}');
    if(pub&&!same(v.unit,scalar()))fail('E_UNIT_ERASURE','main requires scale-one scalar');
    boundary(result,v,'E_REFINEMENT_RETURN');
    let body=v.ir;
    for(let i=bindings.length-1;i>=0;i--)body={kind:'local',...bindings[i],body};
    const index=functions.length;
    functions.push({module:null,name:n,kind:'fnc',pub,params,body});
    if(pub){
      if(peek().kind!=='eof')fail('E_SYNTAX','unexpected trailing source');
      return {sourceNamespace:null,modules:[],functions};
    }
    signatures.set(n,{index,params:types,result});
  }
}
