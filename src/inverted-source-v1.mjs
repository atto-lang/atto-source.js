import {validateInvertedIRV1,INVERTED_IR_VERSION,INVERTED_IR_DIALECT,INVERTED_IR_INT_MODEL} from "./inverted-ir-v1.mjs";
// Intentionally opt-in compiler lane. This is a bounded, lexed, typed source
// slice; no regular-expression rewriting of source access and no AoS fallback.
const MAX_SOURCE = 65536;
const MAX_TOKENS = 8192;
const MAX_STMTS = 256;
const MIN_I64 = -(1n << 63n), MAX_I64 = (1n << 63n) - 1n;
const SCALARS = Object.freeze({int:"i64",i64:"i64",float:"f64",f64:"f64",bool:"bool"});

export class InvertedSourceCompileError extends Error {
  constructor(message, offset = 0) {
    super("error: inverted-v1: " + message + " at offset " + offset);
    this.name = "InvertedSourceCompileError";
  }
}
const reject = (reason, token) => { throw new InvertedSourceCompileError(reason, token?.at ?? 0); };

function tokenize(source) {
  if (typeof source !== "string" || source.length > MAX_SOURCE ||
      new TextEncoder().encode(source).length > MAX_SOURCE)
    reject("invalid or oversized source");
  const result = [];
  const re = /(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|[0-9]+(?:\.[0-9]+)?|[\[\]{}()<>,;:.+=-])/y;
  let position = 0;
  while (position < source.length) {
    re.lastIndex = position;
    const match = re.exec(source);
    if (!match) reject("unsupported source token", {at:position});
    const token = match[0];
    if (!/^\s|^\/\//.test(token) && !token.startsWith("/*")) {
      if (result.length >= MAX_TOKENS) reject("token budget exceeded", {at:position});
      result.push({value:token,at:position});
    }
    position = re.lastIndex;
  }
  result.push({value:"<eof>",at:position});
  return result;
}

function literalType(token, signed = false) {
  if (/^[0-9]+$/.test(token.value)) {
    const n = BigInt(token.value) * (signed ? -1n : 1n);
    if (n < MIN_I64 || n > MAX_I64) reject("signed i64 literal overflow",token);
    return {type:"i64",js:n.toString()+"n",value:n.toString(),expr:{kind:"literal",value:n.toString()}};
  }
  if (/^[0-9]+\.[0-9]+$/.test(token.value)) {
    const n = Number(token.value) * (signed ? -1 : 1);
    if (!Number.isFinite(n)) reject("nonfinite f64 literal",token);
    return {type:"f64",js:JSON.stringify(n),value:String(n)};
  }
  if (!signed && (token.value === "true" || token.value === "false"))
    return {type:"bool",js:token.value,value:token.value};
  reject("scalar literal required",token);
}

class CheckedParser {
  constructor(tokens) {this.ts=tokens;this.i=0;this.locals=new Map();this.schemas=new Map();this.next=0;this.statements=[]; }
  peek(){return this.ts[this.i];}
  take(value){if(this.peek().value===value){this.i++;return true;}return false;}
  expect(value){if(!this.take(value))reject("expected "+value+", found "+this.peek().value,this.peek());}
  identifier(){
    const t=this.peek();
    if(!/^[A-Za-z_][A-Za-z_0-9]*$/.test(t.value))
      reject("identifier required",t);
    this.i++;
    return t.value;
  }
  local(name) {
    const ref=this.locals.get(name);
    if(!ref) reject("unknown local "+name,this.peek());
    return ref;
  }
  number() {
    const negative=this.take("-");
    const t=this.peek();this.i++;
    return literalType(t,negative);
  }
  literal(){if(this.peek().value==="true" || this.peek().value==="false")return this.number();return this.number();}
  classDecl(){
    this.expect("inverted");this.expect("class");
    const name=this.identifier();
    if(this.schemas.has(name))reject("duplicate nominal class",this.peek());
    this.expect("as");
    const fields=[],names=new Set();
    while(!this.take("end")){
      if(this.peek().value==="<eof>" || fields.length>=64)reject("unterminated or oversized inverted class",this.peek());
      const kindName=this.identifier(),type=SCALARS[kindName];
      if(!type)reject("pointer-free i64/f64/bool scalar fields only",this.peek());
      const fieldName=this.identifier();
      if(names.has(fieldName))reject("duplicate class field",this.peek());
      names.add(fieldName);
      this.expect(";");
      fields.push({name:fieldName,type});
    }
    if(!fields.length)reject("empty inverted class",this.peek());
    this.schemas.set(name,{name,fields,byName:new Map(fields.map((x,i)=>[x.name,{...x,ordinal:i}]))});
  }
  parsePrefix() {
    let pub=this.take("pub");
    this.expect("define");
    pub=this.take("pub")||pub;
    return pub;
  }
  parse() {
    const publicClass=this.parsePrefix();
    this.classDecl();
    // v1 admits exactly one nominal declaration per program.
    const pub=this.parsePrefix();
    this.expect("fnc");
    const name=this.identifier();
    if(name!=="main" || !pub)reject("v1 requires define pub fnc main",this.peek());
    this.expect("(");this.expect(")");
    this.expect(":");
    const result=this.identifier();
    if(result!=="int" && result!=="i64")reject("main must return i64",this.peek());
    this.expect("{");
    let returned=false;
    while(!this.take("}")){
      if(this.peek().value==="<eof>" || this.statements.length>=MAX_STMTS)
        reject("unterminated or oversized main body",this.peek());
      if(returned)reject("statements after return not supported",this.peek());
      if(this.take("let"))this.declare();
      else if(this.take("return")){
        const value=this.sum();
        if(value.type!=="i64")reject("return type is not i64",this.peek());
        this.expect(";");
        this.statements.push({kind:"return",expr:value.expr});
        returned=true;
      } else this.mutation();
    }
    if(!returned)reject("main must return",this.peek());
    this.expect("<eof>");
    const declared=[...this.schemas.values()][0];
    return {schema:{name:declared.name,fields:declared.fields},statements:this.statements};
  }
  declare(){
    const name=this.identifier();
    if(this.locals.has(name))reject("duplicate local "+name,this.peek());
    this.expect("=");
    if(this.take("InvertedArray")){
      this.expect("<");const type=this.identifier();this.expect(">");
      if(!this.schemas.has(type))reject("unresolved nominal inverted type",this.peek());
      this.expect(".");this.expect("with_capacity");this.expect("(");
      const capacity=this.number();
      if(capacity.type!=="i64")reject("capacity must be integer",this.peek());
      const n=BigInt(capacity.js.slice(0,-1));
      if(n<1n || n>2147483647n)reject("capacity outside supported bounds",this.peek());
      this.expect(")");this.expect(";");
      const symbol="_v"+this.next++;
      this.locals.set(name,{kind:"array",nominal:type,symbol});
      this.statements.push({kind:"alloc",slot:Number(symbol.slice(2)),capacity:Number(n)});
      return;
    }
    const arrayName=this.identifier(),array=this.local(arrayName);
    if(array.kind!=="array")reject("push requires owning inverted array",this.peek());
    this.expect(".");this.expect("push");this.expect("(");
    const declared=this.identifier();
    if(declared!==array.nominal)reject("push nominal type mismatch",this.peek());
    const schema=this.schemas.get(declared);
    this.expect("{");
    const values=new Map();
    while(!this.take("}")){
      const fieldName=this.identifier();
      const field=schema.byName.get(fieldName);
      if(!field || values.has(fieldName))reject("unknown or repeated row field",this.peek());
      this.expect(":");
      const value=this.literal();
      if(value.type!==field.type)reject("row field type mismatch: "+fieldName,this.peek());
      values.set(fieldName,{type:value.type,value:value.value});
      if(!this.take(",")){this.expect("}");break;}
    }
    if(values.size!==schema.fields.length)reject("row missing declared fields",this.peek());
    this.expect(")");this.expect(";");
    const symbol="_v"+this.next++;
    this.locals.set(name,{kind:"handle",nominal:array.nominal,owner:array.symbol,symbol});
    this.statements.push({kind:"push",slot:Number(symbol.slice(2)),
      owner:Number(array.symbol.slice(2)),values:schema.fields.map(f=>values.get(f.name))});
  }
  selector(name,forWrite=false){
    const arr=this.local(name);
    if(arr.kind!=="array")reject("index receiver requires inverted array",this.peek());
    this.expect("[");
    let index,handle=false;
    const t=this.peek();
    if(t.value==="-"||/^[0-9]+$/.test(t.value)){
      const val=this.number();
      if(val.type!=="i64")reject("integer dense index required",t);
      index=val.js;
    } else {
      const handleName=this.identifier(),h=this.local(handleName);
      if(h.kind!=="handle" || h.owner!==arr.symbol || h.nominal!==arr.nominal)
        reject("foreign or nonnominal row handle",t);
      handle=true;index=h.symbol;
    }
    this.expect("]");this.expect(".");
    const fieldName=this.identifier();
    const field=this.schemas.get(arr.nominal).byName.get(fieldName);
    if(!field)reject("unknown inverted field "+fieldName,this.peek());
    const owner=Number(arr.symbol.slice(2));
    const idx=handle ? {kind:"handle",slot:Number(index.slice(2))} :
      {kind:"position",value:BigInt(index.slice(0,-1)).toString()};
    return {type:field.type,expr:{kind:"read",owner,index:idx,field:field.ordinal},
      writeNode:value=>({kind:"write",owner,index:idx,field:field.ordinal,value})};
  }
  mutation(){
    const name=this.identifier();
    const arr=this.local(name);
    if(arr.kind!=="array")reject("only array mutation is supported",this.peek());
    if(this.take(".")){
      this.expect("erase_swap");this.expect("(");
      const handleName=this.identifier(),h=this.local(handleName);
      if(h.kind!=="handle" || h.owner!==arr.symbol || h.nominal!==arr.nominal)
        reject("erase_swap needs same-owner row handle",this.peek());
      this.expect(")");this.expect(";");
      this.statements.push({kind:"erase",owner:Number(arr.symbol.slice(2)),handle:Number(h.symbol.slice(2))});
      return;
    }
    const field=this.selector(name,true);
    this.expect("=");
    const val=this.literal();
    if(val.type!==field.type)reject("indexed assignment type mismatch",this.peek());
    this.expect(";");
    this.statements.push(field.writeNode({type:val.type,value:val.value}));
  }
  atom(){
    const t=this.peek();
    if(t.value==="-" || /^[0-9]+$/.test(t.value))return this.number();
    const name=this.identifier();
    return this.selector(name);
  }
  sum(){
    const first=this.atom();
    if(first.type!=="i64")reject("integer return expression required",this.peek());
    let expr=first.expr;
    while(this.take("+")){
      const next=this.atom();
      if(next.type!=="i64")reject("i64 addition requires i64 operands",this.peek());
      expr={kind:"add",left:expr,right:next.expr};
    }
    return {type:"i64",expr};
  }
}

export function compileToInvertedIRV1(source) {
  const parsed=new CheckedParser(tokenize(source)).parse();
  return validateInvertedIRV1({
    schemaVersion:INVERTED_IR_VERSION,
    dialect:INVERTED_IR_DIALECT,
    integerModel:INVERTED_IR_INT_MODEL,
    ...parsed
  });
}

export function compileInvertedIRV1(input,{runtimeSpecifier="./worker-inverted-array.mjs"}={}){
  // This is a trusted host build option, never a user/source expression.
  if(typeof runtimeSpecifier!=="string" || runtimeSpecifier.length>1024 ||
     !(runtimeSpecifier.startsWith("./") || runtimeSpecifier.startsWith("file:")))
    reject("unsupported trusted runtime import specifier");
  const ir=validateInvertedIRV1(input);
  const descriptors=ir.schema.fields;
  const scalar=value=>{
    if(value.type==="i64")return value.value+"n";
    return value.value;
  };
  const rowIndex=idx=>idx.kind==="position"?idx.value+"n":"_v"+idx.slot;
  function expression(expr,depth=0){
    if(depth>128)reject("inverted IR emission depth exceeded");
    if(expr.kind==="literal")return expr.value+"n";
    if(expr.kind==="read")return "_v"+expr.owner+"."+
      (expr.index.kind==="position"?"readAt(":"read(")+
      rowIndex(expr.index)+",_field"+expr.field+")";
    if(expr.kind==="add")
      return "_checked_add("+expression(expr.left,depth+1)+","+expression(expr.right,depth+1)+")";
    reject("invalid emitted IR expression");
  }
  const out=[
    "// Generated from validated Oreslang inverted IR v1; actor-independent SoA.",
    "import {InvertedSchema,WorkerInvertedArray} from "+JSON.stringify(runtimeSpecifier)+";",
    "const _schema=new InvertedSchema("+JSON.stringify(descriptors)+");",
    ...descriptors.map((f,i)=>"const _field"+i+"=_schema.bindField("+JSON.stringify(f.name)+");"),
    "function _checked_add(a,b){const v=a+b;if(typeof a!==\"bigint\"||typeof b!==\"bigint\"||v<-(1n<<63n)||v>(1n<<63n)-1n)throw new RangeError(\"ORES_I64_OVERFLOW\");return v;}",
    "export function main(){const _owners=[];try{"
  ];
  for(const stmt of ir.statements){
    switch(stmt.kind){
      case "alloc":
        out.push("const _v"+stmt.slot+"=new WorkerInvertedArray(_schema,{capacity:"+stmt.capacity+"});_owners.push(_v"+stmt.slot+");");
        break;
      case "push":
        out.push("const _v"+stmt.slot+"=_v"+stmt.owner+".push({"+
          descriptors.map((f,i)=>"["+JSON.stringify(f.name)+"]:"+scalar(stmt.values[i])).join(",")+"});");
        break;
      case "write":
        out.push("_v"+stmt.owner+"."+(stmt.index.kind==="position"?"writeAt(":"write(")+
          rowIndex(stmt.index)+",_field"+stmt.field+","+scalar(stmt.value)+");");
        break;
      case "erase":
        out.push("_v"+stmt.owner+".eraseSwap(_v"+stmt.handle+");");
        break;
      case "return":
        out.push("return "+expression(stmt.expr)+";");
        break;
      default:reject("invalid admitted IR statement");
    }
  }
  out.push("}finally{for(let _i=_owners.length-1;_i>=0;_i--)_owners[_i].close();}}");
  return out.join("\n")+"\n";
}
export function compileInvertedSourceV1(source,options={}) {
  return compileInvertedIRV1(compileToInvertedIRV1(source),options);
}
