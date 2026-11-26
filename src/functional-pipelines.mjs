// Bounded Atto i64 functional pipeline source compiler -> executable ESM.
// Pure by default; explicit capability profile allows main-only i64 println.
// Source is lexed, parsed and checked; no eval, dynamic import, ambient I/O or
// raw input splice occurs in generated guest module.
const MAX_SOURCE = 16 * 1024;
const MAX_TOKENS = 512;
const MAX_DEPTH = 32;
const MIN = -(1n << 63n), MAX = (1n << 63n) - 1n;
const RESERVED = new Set([
  'fnc','pub','int','return','val','let','true','false','bool','actor',
  'unsafe','await','async','susp','suspends','critical','trap','panic','raise',
  'throw','borrow','take','share','copy','drop','pin','rt','io','stdio',
  'process','spawn','select','import','module','define','namespace','use',
  'pipe','rpipe','sync','task','yield','constructor','prototype','__proto__'
]);
export class FunctionalPipelineSourceError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'FunctionalPipelineSourceError'; }
}
const deny = code => { throw new FunctionalPipelineSourceError(code); };
function tokenize(src) {
  if (typeof src !== 'string' || new TextEncoder().encode(src).length > MAX_SOURCE || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(src)) deny('E_SOURCE');
  const tokens=[]; let i=0;
  while (i<src.length) {
    if (/[\t\n\r ]/.test(src[i])) { i++; continue; }
    if (src.startsWith('//',i)) { i+=2; while(i<src.length && src[i]!=='\n') i++; continue; }
    if (src.startsWith('/*',i)) {
      i+=2; const end=src.indexOf('*/',i); if (end<0) deny('E_LEX'); i=end+2;continue;
    }
    if (src.charCodeAt(i)>0x7e) deny('E_SOURCE');
    if (tokens.length>=MAX_TOKENS) deny('E_TOKEN_LIMIT');
    const m=/^(?:[A-Za-z_][A-Za-z_0-9]*|[0-9]+|\|>|<\||->|[(){}:.,;+*\/=\-])/.exec(src.slice(i));
    if (!m) deny('E_LEX');
    tokens.push(m[0]);i+=m[0].length;
  }
  tokens.push('<eof>');return tokens;
}
const node = (kind,...args) => ({kind,args});
class Parser {
  constructor(text,allowStdio) { this.tokens=tokenize(text);this.pos=0;this.nodes=0;this.allowStdio=allowStdio; }
  get token() { return this.tokens[this.pos]; }
  eat(x) { if(this.token!==x) return false;this.pos++;return true; }
  need(x) { if(!this.eat(x)) deny('E_PARSE'); }
  name() {
    const n=this.token;
    if (!/^[a-z_][a-z_0-9]*$/.test(n)||RESERVED.has(n)||n.length>128) deny('E_NAME');
    this.pos++;return n;
  }
  make(kind,...args) {if(++this.nodes>2048) deny('E_NODE_LIMIT');return node(kind,...args);}
  args(depth) {
    this.need('(');const values=[];
    if (this.token!==')') do {
      values.push(this.expr(0,depth+1));
      if(values.length>8) deny('E_LIMIT');
    } while(this.eat(','));
    this.need(')');return values;
  }
  expr(min=0,depth=0,direction=null) {
    if(depth>MAX_DEPTH) deny('E_DEPTH');
    let lhs;
    if(this.eat('(')) {lhs=this.expr(0,depth+1);this.need(')');}
    else if(this.eat('-')) {lhs=this.make('neg',this.expr(30,depth+1,direction));}
    else if(/^[0-9]/.test(this.token)) {
      const value=BigInt(this.token);
      if(value>MAX+1n) deny('E_LITERAL');
      this.pos++;lhs=this.make('literal',value);
    } else if(this.token==='true'||this.token==='false') deny('E_TYPE');
    else {const name=this.name();lhs=this.token==='('?this.make('call',name,this.args(depth)):this.make('ref',name);}
    while(true) {
      const op=this.token,prec=op==='*'||op==='/'?20:op==='+'||op==='-'?10:op==='|>'||op==='<|'?5:-1;
      if(prec<min) break;
      this.pos++;
      if(op==='|>'||op==='<|') {
        if(direction&&direction!==op) deny('E_MIXED_PIPE');direction=op;
        if(op==='|>') {
          const name=this.name(),args=this.token==='('?this.args(depth+1):[];
          if(args.length>=8) deny('E_ARITY');lhs=this.make('call',name,[lhs,...args]);
        } else {
          if(!['ref','call'].includes(lhs.kind)) deny('E_CALLEE');
          const name=lhs.args[0],args=lhs.kind==='call'?lhs.args[1]:[];
          if(args.length>=8) deny('E_ARITY');
          lhs=this.make('call',name,[this.expr(prec,depth+1,direction),...args]);
        }
      } else {
        if(op==='/') deny('E_UNSUPPORTED');
        lhs=this.make(op==='+'?'add':op==='-'?'sub':'mul',lhs,this.expr(prec+1,depth+1,direction));
      }
    }
    return lhs;
  }
  body(locals,prints,name) {
    while(this.eat('val')) {
      const name=this.name();this.need('=');const init=this.expr();this.need(';');
      if(locals.length>=4) deny('E_LIMIT');locals.push({name,init});
    }
    while(this.eat('stdio')) {
      if(!this.allowStdio||name!=='main') deny('E_PERMISSION');
      this.need('.');if(!this.eat('println')) deny('E_STDIO');
      this.need('(');const value=this.expr();this.need(')');this.need(';');
      if(prints.length>=4) deny('E_LIMIT');prints.push(value);
    }
    this.need('return');const e=this.expr();this.need(';');this.need('}');return e;
  }
  parse() {
    const functions=[];
    while(this.token!=='<eof>') {
      this.eat('pub');this.need('fnc');const name=this.name();this.need('(');
      const params=[];
      if(this.token!==')') do {
        this.need('int');const arg=this.name();if(params.includes(arg)) deny('E_DUP_PARAM');
        params.push(arg);if(params.length>8) deny('E_LIMIT');
      } while(this.eat(','));
      this.need(')');const colon=this.eat(':');if(!colon)this.need('->');this.need('int');
      const locals=[],prints=[];let result;
      if(this.eat('{')) result=this.body(locals,prints,name);
      else if(colon&&this.eat('->')) {
        if(this.eat('{'))result=this.body(locals,prints,name);
        else {result=this.expr();this.need(';');}
      } else deny('E_PARSE');
      functions.push({name,params,locals,prints,result});if(functions.length>64) deny('E_LIMIT');
    }
    return functions;
  }
}
function check(functions) {
  const symbols=new Map(),state=new Map();
  for(const f of functions){if(symbols.has(f.name))deny('E_DUP_FUNCTION');symbols.set(f.name,f);}
  if(!symbols.has('main')||symbols.get('main').params.length!==0) deny('E_ENTRY');
  function expr(e,scope) {
    switch(e.kind) {
      case 'literal': if(e.args[0]>MAX)deny('E_LITERAL');return;
      case 'neg':
        if(e.args[0].kind==='literal'&&e.args[0].args[0]===MAX+1n)return;
        return expr(e.args[0],scope);
      case 'ref': if(!scope.has(e.args[0]))deny('E_SYMBOL');return;
      case 'add':case 'sub':case 'mul':for(const a of e.args)expr(a,scope);return;
      case 'call': {
        const [name,args]=e.args,callee=symbols.get(name);
        if(!callee) deny('E_SYMBOL');if(args.length!==callee.params.length)deny('E_ARITY');
        if(name==='main'&&callee.prints.length)deny('E_EFFECT_CALL');
        for(const arg of args) expr(arg,scope);
        fn(name);return;
      }
      default:deny('E_AST');
    }
  }
  function fn(name) {
    if(state.get(name)===2)return;if(state.get(name)===1)deny('E_CYCLE');
    state.set(name,1);const f=symbols.get(name),scope=new Set(f.params);
    for(const local of f.locals){expr(local.init,scope);if(scope.has(local.name))deny('E_DUP_LOCAL');scope.add(local.name);}
    for(const value of f.prints)expr(value,scope);
    expr(f.result,scope);state.set(name,2);
  }
  for(const name of symbols.keys())fn(name);
}
const checkedGuest = `const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;\nfunction checked(x){if(x<MIN||x>MAX)throw RangeError('E_OVERFLOW');return x;}\n`;
function emitExpr(e,fn) {
  const v=x=>emitExpr(x,fn);
  switch(e.kind) {
    case 'literal':return `checked(${e.args[0]}n)`;
    case 'neg':
      if(e.args[0].kind==='literal'&&e.args[0].args[0]===MAX+1n)
        return `checked(-${MAX+1n}n)`;
      return `checked(-${v(e.args[0])})`;
    case 'ref':return (fn.params.includes(e.args[0])?'p_':'v_')+e.args[0];
    case 'add':return `checked(${v(e.args[0])}+${v(e.args[1])})`;
    case 'sub':return `checked(${v(e.args[0])}-${v(e.args[1])})`;
    case 'mul':return `checked(${v(e.args[0])}*${v(e.args[1])})`;
    case 'call':return `f_${e.args[0]}(${e.args[1].map(v).join(',')})`;
    default:deny('E_AST');
  }
}
export function compileFunctionalPipelineSource(source,{allowStdio=false}={}) {
  if(typeof allowStdio!=='boolean')deny('E_PERMISSION');
  const functions=new Parser(source,allowStdio).parse();check(functions);
  const effectful=functions.find(f=>f.name==='main').prints.length>0;
  let out=`// Checked and compiled Atto int64 guest; no dynamic host evaluator.\n${checkedGuest}`;
  for(const f of functions) {
    out+=`function f_${f.name}(${f.name==='main'&&effectful?'print_i64':f.params.map(x=>'p_'+x).join(',')}){\n`;
    for(const b of f.locals) out+=`const v_${b.name}=${emitExpr(b.init,f)};\n`;
    for(const value of f.prints)out+=`print_i64(${emitExpr(value,f)});\n`;
    out+=`return ${emitExpr(f.result,f)};\n}\n`;
    if(out.length>65536)deny('E_OUTPUT_LIMIT');
  }
  out+=effectful?'export function main(print_i64){if(typeof print_i64!=="function")throw Error("E_PERMISSION");return f_main(print_i64);}\n':'export function main(){return f_main();}\n';return out;
}
