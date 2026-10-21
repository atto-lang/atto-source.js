import {compileStructuralProjectionIR} from './structural-projection-ir.mjs';

/** Small, opt-in source frontend for the existing readonly scalar structural IR.
 * This is deliberately NOT a general Oreslang parser or a way to bypass the
 * shared frontend. Unsupported syntax fails before code generation.
 */
export class StructuralSourceError extends Error {
  constructor(message, token) {
    super('structural source: ' + message + (token ? ' at ' + token.line + ':' + token.col : ''));
    this.name='StructuralSourceError';
  }
}
const MAX_BYTES=262144, MAX_TOKENS=30000;
const fail=(message,token)=>{throw new StructuralSourceError(message,token);};
function tokenize(source) {
  if(typeof source!=='string'||new TextEncoder().encode(source).length>MAX_BYTES)
    fail('invalid or oversized source');
  const tokens=[];let pos=0,line=1,col=1;
  function advance(){if(source[pos]==='\n'){line++;col=1;}else col++;pos++;}
  function emit(kind,value,loc){if(tokens.length>=MAX_TOKENS)fail('token budget exceeded',loc);tokens.push({kind,value,...loc});}
  while(pos<source.length){
    const loc={line,col},c=source[pos];
    if(/\s/.test(c)){advance();continue;}
    if(source.startsWith('//',pos)){while(pos<source.length&&source[pos]!=='\n')advance();continue;}
    if(source.startsWith('/*',pos)){
      advance();advance();let depth=1;
      while(depth&&pos<source.length){
        if(source.startsWith('/*',pos)){if(++depth>64)fail('comment nesting limit',loc);advance();advance();}
        else if(source.startsWith('*/',pos)){depth--;advance();advance();}
        else advance();
      }
      if(depth)fail('unterminated comment',loc);
      continue;
    }
    if(/[A-Za-z_]/.test(c)){
      let value='';while(pos<source.length&&/[A-Za-z0-9_]/.test(source[pos])){value+=source[pos];advance();}
      if(value.length>128)fail('identifier too long',loc);
      emit('id',value,loc);continue;
    }
    if(/[0-9]/.test(c)){
      let value='';while(pos<source.length&&/[0-9]/.test(source[pos])){value+=source[pos];advance();}
      if(value.length>20)fail('integer literal too long',loc);
      emit('int',value,loc);continue;
    }
    if(c==='"'){
      const start=pos;advance();let closed=false;
      while(pos<source.length){
        if(source[pos]==='"'){advance();closed=true;break;}
        if(source[pos]==='\\'){
          advance();if(pos>=source.length)break;advance();continue;
        }
        if(source.charCodeAt(pos)<32)fail('unescaped control in string',loc);
        advance();
      }
      if(!closed)fail('unterminated string',loc);
      const raw=source.slice(start,pos);
      let value;try{value=JSON.parse(raw);}catch{fail('invalid JSON string escape',loc);}
      if(value.length>4096)fail('string literal too long',loc);
      emit('string',value,loc);continue;
    }
    if('(){}:,;=.-'.includes(c)){emit('sym',c,loc);advance();continue;}
    fail('unsupported character',loc);
  }
  tokens.push({kind:'eof',value:'<eof>',line,col});return tokens;
}
class Parser {
  constructor(tokens){this.tokens=tokens;this.pos=0;}
  get t(){return this.tokens[this.pos];}
  eat(s){if(this.t.value===s){this.pos++;return true;}return false;}
  expect(s){if(!this.eat(s))fail('expected '+s+', got '+this.t.value,this.t);}
  id(){const t=this.t;if(t.kind!=='id')fail('identifier expected',t);this.pos++;return t.value;}
  type(){const t=this.t,v=this.id();if(!['int','bool','string'].includes(v))fail('unsupported scalar type '+v,t);return v;}
  fieldDescriptor(publicly){const name=this.id();this.expect(':');return {name,type:this.type(),public:publicly};}
  contract(){
    let result=null;
    if(this.t.value==='define'&&['interface','trait'].includes(this.tokens[this.pos+1]?.value)){
      this.expect('define');const kind=this.id(),name=this.id();this.eat('as');
      const fields=[];
      while(!this.eat('end')){
        if(this.t.kind==='eof'||fields.length>=64)fail('unterminated or oversized contract',this.t);
        fields.push(this.fieldDescriptor(true));this.expect(';');
      }
      result={kind,name,fields};
    }
    return result;
  }
  carrier(){
    this.expect('define');this.expect('class');const name=this.id();this.expect('as');
    const fields=[],slots=[];
    while(!this.eat('end')){
      if(this.t.kind==='eof'||fields.length>=64)fail('unterminated or oversized class',this.t);
      const publicly=this.eat('pub');this.expect('val');
      const type=this.type(),fieldName=this.id();this.expect('=');
      const value=this.literal(type);this.expect(';');
      fields.push({name:fieldName,type,public:publicly});slots.push(value);
    }
    return {kind:'class',name,fields,slots};
  }
  literal(type){
    const t=this.t;
    if(type==='int'){
      const negative=this.eat('-');if(this.t.kind!=='int')fail('integer expected',this.t);
      const raw=this.t.value;this.pos++;
      if(!/^(0|[1-9][0-9]*)$/.test(raw)||negative&&raw==='0')fail('noncanonical i64',t);
      return (negative?'-':'')+raw;
    }
    if(type==='bool'){
      if(this.eat('true'))return true;
      if(this.eat('false'))return false;
      fail('boolean expected',t);
    }
    if(this.t.kind!=='string')fail('string expected',t);
    this.pos++;return t.value;
  }
  structuralParameter(contract){
    const explicit=this.eat('structural');
    // Anonymous record and struct contracts are structural with or without
    // the redundant contextual keyword. Named contracts remain opt-in.
    const anonymousKind=['record','struct'].includes(this.t.value)?this.id():null;
    if(this.eat('{')){
      const fields=[];
      if(!this.eat('}')){
        do{if(fields.length>=64)fail('inline view exceeds 64 fields',this.t);
          fields.push(this.fieldDescriptor(true));}while(this.eat(','));
        this.expect('}');
      }
      return {view:{kind:anonymousKind||'record',readOnly:true,fields},mode:'inline-anonymous'};
    }
    if(anonymousKind)fail('anonymous aggregate type requires {',this.t);
    const t=this.t,requested=this.id();
    if(!explicit)fail('nominal named parameter needs explicit structural',t);
    if(!contract||requested!==contract.name)fail('unknown structural contract',t);
    return {view:{kind:contract.kind,readOnly:true,fields:contract.fields},mode:'explicit'};
  }
  projection(contract){
    this.expect('fnc');const fnName=this.id();this.expect('(');
    let arg,parameter;
    // Canonical Oreslang accepts both type-first and name-first parameter
    // declarations. Structural semantics must not depend on declaration order.
    if(this.t.kind==='id'&&this.tokens[this.pos+1]?.value===':'){
      arg=this.id();this.expect(':');parameter=this.structuralParameter(contract);
    }else{
      parameter=this.structuralParameter(contract);arg=this.id();
    }
    const {view,mode}=parameter;
    this.expect(')');this.expect(':');const result=this.type();
    this.expect('{');this.expect('return');this.expect(arg);this.expect('.');const select=this.id();
    this.expect(';');this.expect('}');
    const selected=view.fields.find(f=>f.name===select);
    if(!selected||selected.type!==result)fail('return type or selected view member mismatch',this.t);
    return {fnName,view,mode,result,select};
  }
  main(projection,carrier){
    this.expect('pub');this.expect('fnc');this.expect('main');this.expect('(');this.expect(')');
    this.expect(':');const type=this.type();
    if(type!==projection.result)fail('main return type mismatch',this.t);
    this.expect('{');this.expect('return');this.expect(projection.fnName);
    this.expect('(');this.expect('new');this.expect(carrier.name);this.expect('(');this.expect(')');this.expect(')');
    this.expect(';');this.expect('}');this.expect('<eof>');
  }
  parse(){
    const contract=this.contract(),carrier=this.carrier(),projection=this.projection(contract);
    this.main(projection,carrier);
    return {schemaVersion:1,kind:'readonly-scalar-projection',mode:projection.mode,
      carrier:{kind:carrier.kind,name:carrier.name,fields:carrier.fields},
      view:projection.view,slots:carrier.slots,select:projection.select};
  }
}
/** Returns a deliberately restricted compiler-produced projection IR. */
export function parseStructuralProjectionSource(source){return new Parser(tokenize(source)).parse();}
/** Source -> checked typed IR -> trusted ESM. No JS host-object shape inference. */
export function compileStructuralProjectionSource(source,{portable=false}={}){
  return compileStructuralProjectionIR(parseStructuralProjectionSource(source),{portable});
}
