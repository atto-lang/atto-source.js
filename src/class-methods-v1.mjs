/**
 * Experimental, opt-in source-to-ESM lowering for fieldless synchronous classes.
 * No fallback to scalar-v1/program-v2, JS eval, dynamic type scoring or fake
 * actor/ownership support. The receiver is compiler-owned and excluded from
 * the caller-visible method selector (class, name, user argument count).
 */
const MAX_BYTES=262144, MAX_TOKENS=30000, MAX_ARITY=32, MAX_INT_DIGITS=19;
const MIN=-(1n<<63n), MAX=(1n<<63n)-1n;
export class ClassMethodsError extends Error {
  constructor(message,offset){super('error: class methods v1: '+message+' at offset '+offset);this.name='ClassMethodsError';}
}
const fail=(message,at)=>{throw new ClassMethodsError(message,at);};
function lex(source){
  if(typeof source!=='string'||new TextEncoder().encode(source).length>MAX_BYTES)fail('invalid or oversized source',0);
  // TextEncoder replaces unpaired UTF-16 surrogates with U+FFFD. Reject
  // malformed source before that lossy conversion, even inside comments.
  for(let i=0;i<source.length;i++){
    const unit=source.charCodeAt(i);
    if(unit===0)fail('NUL in source',i);
    if(unit>=0xd800&&unit<=0xdbff){
      const lo=source.charCodeAt(i+1);
      if(!(lo>=0xdc00&&lo<=0xdfff))fail('invalid UTF-16 source',i);
      i++;
    }else if(unit>=0xdc00&&unit<=0xdfff)fail('invalid UTF-16 source',i);
  }
  const result=[]; let p=0;
  while(p<source.length){
    if(/\s/.test(source[p])){p++;continue;}
    if(source.startsWith('//',p)){p=source.indexOf('\n',p)<0?source.length:source.indexOf('\n',p)+1;continue;}
    if(source.startsWith('/*',p)){
      const start=p;p+=2;let depth=1;
      while(p<source.length&&depth){
        if(source.startsWith('/*',p)){if(++depth>64)fail('comment depth',start);p+=2;}
        else if(source.startsWith('*/',p)){depth--;p+=2;}else p++;
      }
      if(depth)fail('unterminated comment',start);
      continue;
    }
    const start=p;let value;
    if(/[A-Za-z_]/.test(source[p])){
      while(p<source.length&&/[A-Za-z0-9_]/.test(source[p]))p++;
      value=source.slice(start,p);
    }else if(/[0-9]/.test(source[p])){
      while(p<source.length&&/[0-9_]/.test(source[p]))p++;
      value=source.slice(start,p);
      if(!/^(?:0|[1-9][0-9]*)$/.test(value))fail('invalid integer literal',start);
    }else if(source.startsWith('->',p)||source.startsWith('::',p)){value=source.slice(p,p+2);p+=2;}
    else if('(){},:;+-'.includes(source[p]))value=source[p++];
    else fail('unsupported token',start);
    if(result.length>=MAX_TOKENS)fail('token budget',start);
    result.push({value,at:start});
  }
  result.push({value:'<eof>',at:p});
  return result;
}
const jsName=s=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)&&
  !['default','new','class','export','import','null','true','false','this','super','extends','static','constructor','prototype','__proto__',
    'define','pub','as','end','mtd','self','int','void','return',
    'mut','private','actor','fnc','routine','bool','let','val','const',
    'if','fi','then','else','await','task','nb','do','spawn','module',
    'trait','interface','type','rt'].includes(s);
class Reader{
  constructor(tokens){this.t=tokens;this.i=0;}
  peek(){return this.t[this.i].value;}
  pop(){return this.t[this.i++].value;}
  eat(s){if(this.peek()===s){this.i++;return true;}return false;}
  require(s){if(!this.eat(s))fail('expected '+s+', got '+this.peek(),this.t[this.i].at);}
  id(){const v=this.peek();if(!jsName(v))fail('invalid or reserved identifier '+v,this.t[this.i].at);this.i++;return v;}
  parse(){
    const classes=[];const seen=new Set();
    while(this.peek()!=='<eof>'){
      const prefixPub=this.eat('pub');
      this.require('define');
      const afterPub=prefixPub?false:this.eat('pub');
      this.require('class');const name=this.id();
      if(seen.has(name))fail('duplicate class '+name,this.t[this.i].at);
      seen.add(name);this.require('as');
      const methods=[],slots=new Set();
      while(this.peek()!=='end'){
        if(this.peek()==='<eof>')fail('unterminated class',this.t[this.i].at);
        if(methods.length>=256)fail('method count limit',this.t[this.i].at);
        const pub=this.eat('pub');
        this.eat('mtd'); // formatter-visible marker; optional in source
        const method=this.id();
        this.require('(');
        let receiver=false;
        if(this.eat('self')){
          receiver=true;
          if(this.peek()===','){this.pop();if(this.peek()===')')fail('trailing receiver comma',this.t[this.i].at);}
          else if(this.peek()!==')')fail('unsupported self parameter spelling',this.t[this.i].at);
        }
        const params=[];
        if(this.peek()!==')'){
          do{
            if(params.length>=MAX_ARITY)fail('method arity budget',this.t[this.i].at);
            this.require('int');const param=this.id();
            if(param==='self'||params.includes(param))fail('duplicate or reserved parameter '+param,this.t[this.i].at);
            params.push(param);
          }while(this.eat(','));
        }
        this.require(')');
        const arrow=this.eat('->');
        if(!arrow)this.require(':');
        const type=this.pop();if(type!=='void'&&type!=='int')fail('only void/int return supported',this.t[this.i-1].at);
        const braced=this.eat('{');
        if(!braced){
          if(!arrow)fail('colon method bodies require braces',this.t[this.i].at);
          // Mirror the Java frontend: arrow/end bodies require the explicit
          // double-colon delimiter. Silent delimiter omission is not grammar.
          this.require('::');
        }
        const bodyEnd=braced?'}':'end';
        let body;
        if(type==='void'){
          if(this.eat('return'))this.eat(';');
          body={kind:'void'};
          if(this.peek()!==bodyEnd)fail('void method body unsupported',this.t[this.i].at);
        }else{
          this.require('return');
          let sign=1n,signed=false;
          if(this.eat('-')){sign=-1n;signed=true;}
          else if(this.eat('+'))signed=true;
          const token=this.pop();const position=this.t[this.i-1].at;
          if(/^(?:0|[1-9][0-9]*)$/.test(token)){
            // Any signed-i64 decimal magnitude fits in at most 19 digits.
            // Reject longer tokens before BigInt conversion to keep hostile
            // source from turning one token into disproportionate CPU work.
            if(token.length>MAX_INT_DIGITS)fail('int literal outside i64',position);
            const magnitude=BigInt(token);
            const limit=sign<0n?MAX+1n:MAX;
            if(magnitude>limit)fail('int literal outside i64',position);
            const n=sign*magnitude;
            body={kind:'literal',value:n.toString()};
          }else{
            if(signed)fail('signed method return supports integer literals only',position);
            if(!params.includes(token))fail('unresolved method parameter',position);
            body={kind:'arg',index:params.indexOf(token)};
          }
          this.require(';');
          if(this.peek()!==bodyEnd)fail('nontrivial int method body unsupported',this.t[this.i].at);
        }
        this.require(bodyEnd);
        const slot=method+'/'+params.length;
        if(slots.has(slot))fail('duplicate method name/arity '+slot,this.t[this.i].at);
        slots.add(slot);
        methods.push({name:method,arity:params.length,receiver,pub,body});
      }
      this.require('end');classes.push({name,pub:prefixPub||afterPub,methods});
    }
    if(!classes.length)fail('no classes',0);
    return classes;
  }
}
export function compileClassMethodsV1(source){
  const classes=new Reader(lex(source)).parse();
  let result='// Experimental fieldless class-method source subset; receiver-erased selectors.\n';
  for(let ci=0;ci<classes.length;ci++){
    const cls=classes[ci], local='$OresClass'+ci;
    result+='class '+local+' {\n #oresBrand=1;\n constructor(...args) { if (new.target !== '+local+') throw new TypeError("unsupported class derivation"); if (args.length !== 0) throw new TypeError("constructor arity mismatch"); Object.preventExtensions(this); }\n';
    const families=new Map();
    for(const m of cls.methods)if(m.pub){
      if(!families.has(m.name))families.set(m.name,[]);
      families.get(m.name).push(m);
    }
    for(const [name,methods] of families){
      result+=' '+JSON.stringify(name)+'(...args) {\n';
      result+='  if (this === null || (typeof this !== "object" && typeof this !== "function") || !(#oresBrand in this)) throw new TypeError("invalid Oreslang receiver");\n';
      result+='  switch(args.length){\n';
      for(const m of methods){
        result+='  case '+m.arity+':\n';
        for(let i=0;i<m.arity;i++)result+='   if(typeof args['+i+']!=="bigint"||args['+i+']<'+MIN+'n||args['+i+']>'+MAX+'n)throw new TypeError("expected signed i64 BigInt");\n';
        result+=m.body.kind==='void'?'   return;\n':m.body.kind==='literal'?'   return '+m.body.value+'n;\n':'   return args['+m.body.index+'];\n';
      }
      result+='  default: throw new TypeError("method arity mismatch");\n  }\n }\n';
    }
    result+='}\nObject.freeze('+local+'.prototype);\nObject.freeze('+local+');\n';
    if(cls.pub)result+='export { '+local+' as '+cls.name+' };\n';
  }
  return result;
}
export function checkClassMethodsV1(source){compileClassMethodsV1(source);return true;}
