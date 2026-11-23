import {createScalarIR, validateScalarIR} from './scalar-ir.mjs';
import {rejectExecutionDomains} from './execution-domain-admission.mjs';
import {scanStringLiteral} from './string-literal-syntax.mjs';
import {preflightCoreFutureOwnership} from './core-future-ownership.mjs';
/** Experimental fail-closed Oreslang scalar-to-ESM compiler. */
const MAX_BYTES = 262144;
const I64_MAX = (1n << 63n) - 1n;
export class CompileError extends Error {
  constructor(message, where) {
    super('error: ' + message + (where ? ' at ' + where.line + ':' + where.col : ''));
    this.name = 'CompileError';
  }
}
function validateSourceText(src) {
  if (typeof src !== 'string' || src.length > MAX_BYTES)
    throw new CompileError('invalid or oversized source');
  // UTF-8 bytes cannot be fewer than valid UTF-16 source code units.
  // Reject obviously oversize source before scanning/allocating its encoding.
  // TextEncoder silently replaces unpaired UTF-16 surrogates with U+FFFD.
  // Reject them (and NUL) everywhere, including comments, before encoding.
  for (let i=0; i<src.length; i++) {
    const code=src.charCodeAt(i);
    if (code===0) throw new CompileError('NUL in source');
    // Trojan Source: bidi format controls can reorder displayed source,
    // including comments and literals that the lexer would otherwise skip.
    if (code===0x061c || code===0x200e || code===0x200f ||
        (code>=0x202a && code<=0x202e) ||
        (code>=0x2066 && code<=0x2069))
      throw new CompileError('bidirectional Unicode control in source');
    if (code>=0xd800 && code<=0xdbff) {
      const lo=src.charCodeAt(i+1);
      if (!(lo>=0xdc00 && lo<=0xdfff)) throw new CompileError('invalid UTF-16 in source');
      i++;
    } else if (code>=0xdc00 && code<=0xdfff) {
      throw new CompileError('invalid UTF-16 in source');
    }
  }
  if (new TextEncoder().encode(src).byteLength > MAX_BYTES)
    throw new CompileError('invalid or oversized source');
}
function lex(src) {
  validateSourceText(src);
  const out = [];
  let i=0, line=1, col=1;
  const lineEnd=c=>c==='\n'||c==='\r'||c==='\u0085'||c==='\u2028'||c==='\u2029';
  function advance() {
    const ch=src[i];
    if(lineEnd(ch)){if(ch!=='\n'||src[i-1]!=='\r')line++;col=1;}
    else col++;
    i++;
  }
  function add(kind, value, loc) { if(out.length>=30000) throw new CompileError('token limit exceeded'); out.push({kind,value,...loc}); }
  while(i<src.length){
    if(/\s/.test(src[i])||src[i]==='\u0085') {advance();continue;}
    if(src.startsWith('//',i)){
      // Checked signed-i64 source cannot be silently compiled by the legacy
      // scalar-v1 profile: this emitter currently wraps instead of trapping.
      // Only an actual line-comment directive counts; block comments and
      // other prose must not turn on or mask a numeric profile.
      const loc={line,col};
      let eol=i+2;
      while(eol<src.length&&!lineEnd(src[eol]))eol++;
      const tail=src.slice(i+2,eol).trimStart();
      if(tail.startsWith('oreslang:checked-i64'))
        throw new CompileError('checked-i64 source requires program-v2; scalar-v1 uses provisional wrapping arithmetic',loc);
      while(i<eol)advance();
      continue;
    }
    if(src.startsWith('/*',i)){
      const loc={line,col};advance();advance();let depth=1;
      while(depth&&i<src.length){
        if(src.startsWith('/*',i)){depth++;if(depth>64)throw new CompileError('comment nesting limit',loc);advance();advance();}
        else if(src.startsWith('*'+'/',i)){depth--;advance();advance();}
        else advance();
      }
      if(depth)throw new CompileError('unterminated comment',loc);
      continue;
    }
    const loc={line,col};
    if(/[A-Za-z_]/.test(src[i])){
      let s='';while(i<src.length&&/[A-Za-z0-9_]/.test(src[i])){s+=src[i];advance();}
      add('id',s,loc);
    }else if(/[0-9]/.test(src[i])){
      let s='';while(i<src.length&&/[0-9_]/.test(src[i])){s+=src[i];advance();}
      if(!/^[0-9]+(?:_[0-9]+)*$/.test(s))throw new CompileError('invalid integer literal',loc);
      if (s.length > 64) throw new CompileError('integer literal length limit',loc);
      add('int',s,loc);
    }else if(src[i]==="'" || src[i]==='"' || src[i]==='\x60'){
      // Keep a quoted literal or entire balanced backtick template opaque:
      // keywords, braces and comments inside it are not outer-source tokens.
      let literal;
      try { literal=scanStringLiteral(src,i); }
      catch(error) {
        if(error instanceof SyntaxError)throw new CompileError(error.message,loc);
        throw error;
      }
      while(i<literal.end)advance();
      add(literal.kind,literal,loc);
    }else if(src.startsWith('->',i)||src.startsWith('::',i)){add('sym',src.slice(i,i+2),loc);advance();advance();}
    else if(src[i]==='%')throw new CompileError("'%' is reserved and is not AttoLang source syntax; use Integer.rem(a, b) or Integer.mod(a, b)",loc);
    else if(src[i]==='^')throw new CompileError(src.startsWith('^^',i)?"'^^' is reserved and is not AttoLang source syntax; use Xor(a, b)":"'^' is reserved and is not AttoLang source syntax; use Integer.bitXor(a, b)",loc);
    else if('(){}[]:,;+-*/=.!<>'.includes(src[i])){add('sym',src[i],loc);advance();}
    else throw new CompileError('unsupported character',loc);
  }
  out.push({kind:'eof',value:'<eof>',line,col});return out;
}
function rejectUnloweredInvertedClasses(tokens) {
  for (let i=0; i+2<tokens.length; i++) {
    let at=i;
    if (tokens[at]?.value==='pub' && tokens[at+1]?.value==='define') at++;
    if (tokens[at]?.value!=='define') continue;
    at++;
    if (tokens[at]?.value==='pub') at++;
    if (tokens[at]?.value==='inverted' && tokens[at+1]?.value==='class')
      throw new CompileError(
        'inverted class requires checked bracket-row and ownership lowering in the JS backend',
        tokens[at]);
  }
}
function rejectUnsupportedSelect(tokens) {
  const startsStaticSelect = next =>
    next && ['{','over','first','fair','random'].includes(next.value);
  for (let i=0;i<tokens.length;i++) {
    const token=tokens[i];
    if (token.kind === 'id' && token.value === 'select' &&
        startsStaticSelect(tokens[i+1])) {
      throw new CompileError(
        'static select requires checked Channel/Future arbitration, actor-lane continuation, ownership and cancellation lowering in the JS backend',
        token
      );
    }
  }
}
class Parser {
  constructor(tokens){this.ts=tokens;this.pos=0;this.depth=0;}
  peek(){return this.ts[this.pos];}
  match(v){if(this.peek().value===v){this.pos++;return true;}return false;}
  expect(v){if(!this.match(v))throw new CompileError('expected '+v+', found '+this.peek().value,this.peek());}
  id(){const t=this.peek();if(t.kind!=='id')throw new CompileError('expected identifier',t);this.pos++;return t.value;}
  exportDeclaration(){
    this.expect('export');this.expect('pub');
    let visibility='public';
    if(this.match('[')){this.expect('pkg');this.expect(']');visibility='package';}
    let kind=null;
    if(this.match('class'))kind='class';
    else if(this.match('fnc'))kind='fnc';
    const name=this.id();this.expect(';');
    return {name,kind,visibility};
  }
  parse(){
    const module=this.peek().value==='define' && this.ts[this.pos+1]?.value==='module';
    if(module){this.pos++;this.expect('module');this.id();this.match('as');}
    const functions=[],exports=[];
    while(this.peek().kind!=='eof'&&!(module&&this.peek().value==='end')){
      if(this.peek().value==='export'){
        if(exports.length>=1024)throw new CompileError('file export budget',this.peek());
        exports.push(this.exportDeclaration());continue;
      }
      if(functions.length>=512)throw new CompileError('function limit',this.peek());
      // Accept only one define and one pub, in either canonical order.
      // Deliberately do not admit pub define module in this scalar subset.
      let pub=this.match('pub');
      if(pub){this.match('define');}
      else if(this.match('define')){pub=this.match('pub');}
      const at=this.peek();
      if(!this.match('fnc')&&!this.match('routine'))throw new CompileError('unsupported declaration',at);
      const name=this.id();this.expect('(');const params=[];
      if(!this.match(')')){
        do{if(params.length>=128)throw new CompileError('parameter limit');this.expect('int');const v=this.id();if(params.includes(v))throw new CompileError('duplicate parameter '+v);params.push(v);}while(this.match(','));
        this.expect(')');
      }
      // The bootstrap parser only supports int functions with a single
      // return expression. Support canonical arrow/end spellings without
      // pretending to support arbitrary statement bodies or async functions.
      const arrow=this.match('->');
      if(!arrow)this.expect(':');
      this.expect('int');
      const braced=this.match('{');
      if(!braced&&!arrow)throw new CompileError('expected { for colon function body',this.peek());
      if(!braced){if(!this.match('as'))this.match('::');}
      this.expect('return');
      const body=this.expr();this.expect(';');this.expect(braced?'}':'end');
      functions.push({name,params,body,pub});
    }
    if(module)this.expect('end');
    if(this.peek().kind!=='eof')throw new CompileError('trailing tokens',this.peek());
    if(!functions.length)throw new CompileError('no functions');
    const seen=new Set();
    for(const entry of exports){
      if(seen.has(entry.name))throw new CompileError('duplicate export '+entry.name);
      seen.add(entry.name);
      if(entry.kind!==null&&entry.kind!=='fnc')
        throw new CompileError('export kind mismatch '+entry.name);
      const family=functions.filter(f=>f.name===entry.name);
      if(!family.length)throw new CompileError('unbound export '+entry.name);
      if(entry.visibility==='package'&&family.some(f=>f.pub))
        throw new CompileError('package export conflicts with public declaration '+entry.name);
      if(entry.visibility==='public')family.forEach(f=>{f.pub=true;});
    }
    return functions;
  }
  expr(min=0){
    if(++this.depth>256)throw new CompileError('expression nesting limit',this.peek());
    try{
      let left=this.primary();
      while(true){
        const op=this.peek().value;
        if(op==='/')throw new CompileError('unsupported operator '+op,this.peek());
        const prec=op==='*'?20:op==='+'||op==='-'?10:-1;
        if(prec<min)break;
        this.pos++;left={kind:'binary',op,left,right:this.expr(prec+1)};
      }
      return left;
    }finally{this.depth--;}
  }
  primary(){
    const t=this.peek();
    if(this.match('-')){
      // The absolute magnitude 2^63 is legal only as a negated literal.
      // All other positive literals must remain within signed i64.
      const next=this.peek();
      if(next.kind==='int' && BigInt(next.value.replaceAll('_',''))===(1n<<63n)){
        this.pos++;return {kind:'int',n:-(1n<<63n)};
      }
      return {kind:'neg',inner:this.expr(30)};
    }
    if(this.match('+'))return this.expr(30);
    if(this.match('(')){const v=this.expr();this.expect(')');return v;}
    if(t.kind==='int'){this.pos++;const n=BigInt(t.value.replaceAll('_',''));if(n>I64_MAX)throw new CompileError('positive int outside signed i64',t);return {kind:'int',n};}
    if(t.kind==='string'||t.kind==='template')
      throw new CompileError('quoted strings and template interpolation require typed String lowering; unsupported in JS scalar-v1',t);
    if(t.kind==='id' && t.value==='rt'){
      this.pos++;
      const op=this.peek();
      if(op.kind!=='id')throw new CompileError('expected runtime operation after rt',op);
      if(['ref','unref','deref','raw'].includes(op.value))
        throw new CompileError('pointer-style runtime operation rt '+op.value+' is not valid Oreslang source',op);
      if(op.value==='borrow' && this.ts[this.pos+1]?.value==='mut')
        throw new CompileError("legacy 'rt borrow mut' is not valid Oreslang; use 'rt mut borrow value'",op);
      if(op.value==='mut' && this.ts[this.pos+1]?.value!=='borrow')
        throw new CompileError("'rt mut' only supports borrowing; use 'rt mut borrow value'",op);
      throw new CompileError('runtime ownership operation requires typed lowering in the JS scalar backend',op);
    }
    if(t.kind==='id'&&t.value==='Integer'&&this.ts[this.pos+1]?.value==='.'){
      // Named integer operations replace the reserved %, ^ and ^^ operators.
      this.pos+=2;
      const name=this.peek();
      const ops={rem:'%',mod:'mod',bitXor:'^'};
      if(name.kind!=='id'||!Object.hasOwn(ops,name.value))throw new CompileError('Integer.'+name.value+' is unsupported; use Integer.rem, Integer.mod or Integer.bitXor',name);
      this.pos++;this.expect('(');const left=this.expr();this.expect(',');const right=this.expr();this.expect(')');
      return {kind:'binary',op:ops[name.value],left,right};
    }
    if(t.kind==='id'){
      this.pos++;
      if(this.match('(')){
        const args=[];
        if(!this.match(')')){do{if(args.length>=128)throw new CompileError('argument limit');args.push(this.expr());}while(this.match(','));this.expect(')');}
        return {kind:'call',name:t.value,args};
      }
      return {kind:'var',name:t.value};
    }
    throw new CompileError('unexpected '+t.value,t);
  }
}
// The isolated parser is a bootstrap adapter. Future language frontends
// should produce this versioned IR instead of duplicating parser semantics.
export function compileToIR(source) {
  const tokens=lex(source);
  // Reject affine Future violations at the compiler core boundary before IR.
  // Valid Future code still cannot execute in the scalar-only JS backend.
  preflightCoreFutureOwnership(tokens,(code,message,token)=>{throw new CompileError(code+': '+message,token);});
  rejectExecutionDomains(tokens,(message,token)=>{throw new CompileError(message,token);});
  rejectUnloweredInvertedClasses(tokens);
  rejectUnsupportedSelect(tokens);
  const parsed=new Parser(tokens).parse();
  try {
    return createScalarIR(parsed);
  } catch (error) {
    // Keep the source frontend's stable diagnostics while preserving
    // strict "scalar IR" diagnostics for direct compileIR callers.
    if(error?.name==='ScalarIRError' && typeof error.message==='string' &&
       error.message.startsWith('error: scalar IR: ')) {
      throw new CompileError(error.message.slice('error: scalar IR: '.length));
    }
    throw error;
  }
}
export function compileIR(input) {
  const ir = validateScalarIR(input);
  const fns = ir.functions;
  function lower(e, depth = 0) {
    if (depth > 384) throw new CompileError('expression depth limit during lowering');
    if (e.kind === 'int') return e.value + 'n';
    if (e.kind === 'param') return '_p' + e.index;
    if (e.kind === 'neg') return 'BigInt.asIntN(64,-(' + lower(e.inner, depth+1) + '))';
    if (e.kind === 'binary') {
      // Inline so programs without Integer.mod keep byte-identical output.
      if (e.op === 'mod')
        return '((a,b)=>{if(b===0n)throw new RangeError("ORES_I64_DIVISION_BY_ZERO: checked signed 64-bit remainder by zero");const r=a%b;return r<0n?BigInt.asIntN(64,b>0n?r+b:r-b):r;})(' +
          lower(e.left, depth+1) + ',' + lower(e.right, depth+1) + ')';
      return 'BigInt.asIntN(64,(' + lower(e.left, depth+1) + ')' + e.op + '(' +
        lower(e.right, depth+1) + '))';
    }
    if (e.kind === 'call') {
      return '_f' + e.target + '(' + e.args.map(arg => lower(arg, depth+1)).join(',') + ')';
    }
    throw new CompileError('invalid IR expression');
  }
  const out = [
    '// Oreslang JS scalar subset. Signed i64 wrapping is PROVISIONAL, not proven Java parity.',
    'function _int(v){if(typeof v!=="bigint"||v<-(1n<<63n)||v>(1n<<63n)-1n)throw new TypeError("Oreslang int requires a signed i64 BigInt");return v;}',
  ];
  fns.forEach((f,i) => {
    const params = f.params.map((_,j) => '_p' + j);
    out.push('function _f' + i + '(' + params.join(',') + '){');
    params.forEach(p => out.push('_int(' + p + ');'));
    out.push('return ' + lower(f.body) + ';', '}');
  });
  // String-literal export names prevent ECMAScript keyword collisions.
  fns.forEach((f,i) => {
    if (f.pub) out.push('export { _f' + i + ' as ' + JSON.stringify(f.name) + ' };');
  });
  return out.join('\n') + '\n';
}
export function compile(source) {
  return compileIR(compileToIR(source));
}
export function check(source) {
  compile(source);
  return true;
}
