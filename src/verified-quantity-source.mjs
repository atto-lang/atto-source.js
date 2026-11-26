// Closed signed-i64 profile. Reuse the production lexer and validated checked
// program-v2 emitter; do not route quantities through wrapping scalar-v1.
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n,LIMIT=(1n<<256n)-1n;
const scalar=()=>({powers:new Map(),n:1n,d:1n});
const gcd=(a,b)=>{while(b){[a,b]=[b,a%b]}return a;};
function sameDimensions(a,b){return a.powers.size===b.powers.size&&[...a.powers].every(([k,v])=>b.powers.get(k)===v);}
function same(a,b){return sameDimensions(a,b)&&a.n===b.n&&a.d===b.d;}
function ratio(powers,n,d,fail){
  const g=gcd(n,d); n/=g;d/=g;
  if(n<1n||d<1n||n>LIMIT||d>LIMIT)fail('E_UNIT_LIMIT','normalized scale exceeds 256 bits');
  return {powers,n,d};
}
export function lowerVerifiedQuantitySource(tokens,report){
  if(tokens[0]?.value!=='define'||!['dimension','unit'].includes(tokens[1]?.value))return null;
  let at=0,budget=256;
  const peek=()=>tokens[Math.min(at,tokens.length-1)];
  const fail=(code,msg)=>report(code+': '+msg,peek());
  const take=v=>peek().value===v?(at++,true):false;
  const expect=v=>{if(!take(v))fail('E_SYNTAX','expected '+v);};
  const name=()=>{const t=peek();if(t.kind!=='id')fail('E_UNIT_NAME','expected name');at++;return t.value;};
  const dims=new Set(),bases=new Set(),units=new Map();
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
  const make=(unit,ir,literal=null)=>({unit,ir,literal});
  const int=v=>({kind:'int',value:String(v)});
  function attach(value,target){
    if(!same(value.unit,scalar()))fail('E_UNIT_ATTACHMENT','attachment requires dimensionless scale one');
    return {...value,unit:lookup(target)};
  }
  function cast(value,target,legacy){
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
      const v=atom(depth+1);return make(v.unit,{kind:'neg',inner:v.ir});
    }
    if(take('(')){const v=expr(0,depth+1);expect(')');return postfix({...v,literal:null},depth);}
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
        if(op==='/'&&same(left.unit,scalar())&&same(right.unit,scalar()))fail('E_UNIT_SCALAR_DIVISION','plain scalar division outside quantity profile');
        unit=combine(left.unit,right.unit,op==='/');
      }
      left=make(unit,{kind:'binary',op,left:left.ir,right:right.ir});
    }
    if(min===0&&take('as'))left=cast(left,name(),true);
    return left;
  }
  expect('pub');expect('fnc');expect('main');expect('(');expect(')');expect('->');expect('int');expect('{');expect('return');
  const v=expr(0,0);expect(';');expect('}');
  if(peek().kind!=='eof')fail('E_SYNTAX','unexpected trailing source');
  if(!same(v.unit,scalar()))fail('E_UNIT_ERASURE','main requires scale-one scalar');
  return {sourceNamespace:null,modules:[],functions:[{module:null,name:'main',kind:'fnc',pub:true,params:[],body:v.ir}]};
}
