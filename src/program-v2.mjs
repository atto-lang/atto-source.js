/**
 * Experimental Oreslang program-to-ESM v2 slice:
 * flat runtime modules, private/public functions, qualified calls, integer matches.
 * Standalone parser until the shared typed frontend and IR become available.
 * DOES NOT implement classes, actors, imports, or the type-only namespace grammar.
 */
const MAX_BYTES = 262144, MAX_TOKENS = 30000, MAX_DEPTH = 192;
const MIN = -(1n << 63n), MAX = (1n << 63n) - 1n;
const TOKEN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export class ProgramCompileError extends Error {
  constructor(message, loc) {
    super('error: program v2: ' + message + (loc ? ' at ' + loc.line + ':' + loc.col : ''));
    this.name = 'ProgramCompileError';
  }
}
const fail = (message, loc) => {throw new ProgramCompileError(message, loc);};

function tokenize(source) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_BYTES) fail('oversized or invalid source');
  const result = [];
  let pos = 0, line = 1, col = 1;
  function advance() {
    if (source[pos] === '\n') {line++; col = 1;} else col++;
    pos++;
  }
  function emit(kind, value, start) {
    if (result.length >= MAX_TOKENS) fail('token budget exceeded', start);
    result.push({kind, value, ...start});
  }
  while (pos < source.length) {
    const start = {line, col};
    const c = source[pos];
    if (/\s/.test(c)) {advance(); continue;}
    if (source.startsWith('//',pos)) {
      while (pos < source.length && source[pos] !== '\n') advance();
      continue;
    }
    if (source.startsWith('/*',pos)) {
      advance(); advance(); let nesting = 1;
      while (nesting && pos < source.length) {
        if (source.startsWith('/*',pos)) {
          if (++nesting > 64) fail('comment nesting exceeded',start);
          advance(); advance();
        } else if (source.startsWith('*/',pos)) {
          nesting--; advance(); advance();
        } else advance();
      }
      if (nesting) fail('unterminated comment',start);
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let word = '';
      while (pos < source.length && /[A-Za-z0-9_]/.test(source[pos])) {
        word += source[pos]; advance();
      }
      if (word.length > 128) fail('identifier limit',start);
      emit('id',word,start);
    } else if (/[0-9]/.test(c)) {
      let number = '';
      while (pos < source.length && /[0-9_]/.test(source[pos])) {
        number += source[pos]; advance();
      }
      if (number.length > 64 || !/^[0-9]+(?:_[0-9]+)*$/.test(number)) fail('invalid int literal',start);
      emit('int',number,start);
    } else if (source.startsWith('->',pos)) {
      emit('sym','->',start); advance(); advance();
    } else if ('(){}:,;+-*/%=.'.includes(c)) {
      emit('sym',c,start); advance();
    } else fail('unsupported character',start);
  }
  emit('eof','<eof>',{line,col});
  return result;
}
class Parser {
  constructor(tokens) {this.tokens = tokens;this.i = 0;this.depth = 0;this.expressions = 0;}
  peek() {return this.tokens[this.i];}
  eat(s) {if(this.peek().value === s) {this.i++; return true;} return false;}
  expect(s) {if(!this.eat(s)) fail('expected ' + s + ', found ' + this.peek().value,this.peek());}
  name() {
    const t = this.peek();
    if (t.kind !== 'id' || !TOKEN_NAME.test(t.value)) fail('identifier expected',t);
    this.i++; return t.value;
  }
  functions(moduleName) {
    const pub = this.eat('pub'), start=this.peek();
    if (!this.eat('fnc') && !this.eat('routine')) fail('unsupported declaration',start);
    const kind = this.tokens[this.i-1].value, name = this.name();
    this.expect('(');
    const params = [];
    if (!this.eat(')')) {
      do {
        if (params.length >= 128) fail('parameter limit',this.peek());
        this.expect('int'); const p = this.name();
        if (params.includes(p)) fail('duplicate parameter ' + p);
        params.push(p);
      } while(this.eat(','));
      this.expect(')');
    }
    this.expect(':');this.expect('int');this.expect('{');this.expect('return');
    const body = this.expression();
    this.expect(';');this.expect('}');
    // Exporting a routine as a module object property would make a
    // direct-call-only routine first class. Leave this for runtime/ABI design.
    if (moduleName !== null && pub && kind === 'routine') fail('public module routine requires host ABI design');
    return {module:moduleName, name, kind, pub, params, body};
  }
  parse() {
    // Oreslang's flat source namespace is compile-time package metadata,
    // not a runtime module/object. It must occur only once at file start.
    let namespace = null;
    if (this.eat('namespace')) {
      namespace = this.name();
      this.expect(';');
    }
    const modules = [], functions = [], usedModules = new Set();
    while (this.peek().kind !== 'eof') {
      if (this.eat('define')) {
        this.expect('module'); const name=this.name();
        if (usedModules.has(name)) fail('duplicate module ' + name);
        usedModules.add(name); this.eat('as');
        modules.push(name);
        let count=0;
        while (!this.eat('end')) {
          if (this.peek().kind === 'eof') fail('unterminated module ' + name);
          if (++count > 512 || functions.length >= 512) fail('declaration budget exceeded');
          functions.push(this.functions(name));
        }
      } else {
        if (functions.length >= 512) fail('declaration budget exceeded');
        functions.push(this.functions(null));
      }
    }
    if (!functions.length) fail('empty program');
    return {namespace,modules,functions};
  }
  integer(negative = false) {
    const token=this.peek();
    if (token.kind !== 'int') fail('integer literal expected',token);
    this.i++;
    const n=BigInt(token.value.replaceAll('_','')) * (negative ? -1n : 1n);
    if (n < MIN || n > MAX) fail('int literal outside provisional signed i64',token);
    return n.toString();
  }
  expression(min=0) {
    if (++this.depth > MAX_DEPTH || ++this.expressions > MAX_TOKENS) fail('expression budget exceeded',this.peek());
    try {
      let left = this.primary();
      while (true) {
        const op = this.peek().value;
        if (op === '/') fail('division unsupported in provisional int profile',this.peek());
        const prec=op==='*'||op==='%'?20:op==='+'||op==='-'?10:-1;
        if (prec < min) break;
        this.i++;
        left={kind:'binary',op,left,right:this.expression(prec+1)};
      }
      return left;
    } finally {this.depth--;}
  }
  primary() {
    if (this.eat('-')) {
      if(this.peek().kind === 'int') return {kind:'int',value:this.integer(true)};
      return {kind:'neg',inner:this.expression(30)};
    }
    if(this.eat('+')) return this.expression(30);
    if(this.eat('(')) {
      const e=this.expression();this.expect(')'); return e;
    }
    if(this.eat('match')) return this.matchExpression();
    if(this.peek().kind==='int') return {kind:'int',value:this.integer()};
    const token=this.peek();
    if (token.kind !== 'id') fail('expression expected',token);
    const first=this.name();
    let qualifier=null, symbol=first;
    if(this.eat('.')) {qualifier=first; symbol=this.name();}
    if (!this.eat('(')) {
      if (qualifier) fail('bare module properties not yet supported',token);
      return {kind:'variable', name:first};
    }
    const args=[];
    if(!this.eat(')')) {
      do {
        if(args.length >= 128) fail('argument limit');
        args.push(this.expression());
      } while(this.eat(','));
      this.expect(')');
    }
    return {kind:'call',qualifier,name:symbol,args};
  }
  matchExpression() {
    const subject=this.expression();
    this.eat('over'); // compatibility with documented compact match syntax
    const arms=[], seen=new Set(); let wildcard=false;
    while(this.peek().value !== 'end' && this.peek().kind !== 'eof') {
      let isDefault=false, value=null;
      if(this.eat('else')) isDefault=true;
      else {
        this.expect('on');
        if(this.eat('_')) isDefault=true;
        else value=this.integer(this.eat('-'));
      }
      if(wildcard) fail('unreachable arm after wildcard',this.peek());
      if(isDefault) wildcard=true;
      else {
        if(seen.has(value)) fail('duplicate scalar pattern');
        seen.add(value);
      }
      this.eat('->');
      this.expect('{');
      // A match expression yields its arm expression, not a statement return.
      if(this.peek().value === 'return') fail('return inside expression match is invalid');
      const body=this.expression();
      this.expect(';');this.expect('}');
      arms.push({value, body});
      if (arms.length > 256) fail('match arm limit');
    }
    this.expect('end');
    if (!wildcard) fail('scalar int match requires exhaustive wildcard/else');
    return {kind:'match',subject,arms};
  }
}
function resolveProgram(parsed) {
  const {modules,functions}=parsed;
  const slots = new Map(), exports = new Set();
  functions.forEach((fn,i)=>{
    const qualified=(fn.module===null?'root':fn.module)+'.'+fn.name;
    if(slots.has(qualified)) fail('duplicate function '+qualified);
    slots.set(qualified,i);
    if(fn.pub && fn.module===null) {
      if(exports.has(fn.name)) fail('duplicate ESM export '+fn.name);
      exports.add(fn.name);
    }
  });
  modules.forEach(m=>{
    if(exports.has(m)) fail('module/function export conflict '+m);
    exports.add(m);
  });
  let nodeCount=0;
  function resolve(expr,owner,depth=0) {
    if(++nodeCount>MAX_TOKENS || depth>MAX_DEPTH) fail('IR node/depth budget exceeded');
    switch(expr.kind) {
      case 'int': return expr;
      case 'variable': {
        const index=owner.params.indexOf(expr.name);
        if(index<0) fail('unresolved identifier '+expr.name);
        return {kind:'param',index};
      }
      case 'neg': return {kind:'neg',inner:resolve(expr.inner,owner,depth+1)};
      case 'binary': return {kind:'binary',op:expr.op,left:resolve(expr.left,owner,depth+1),right:resolve(expr.right,owner,depth+1)};
      case 'call': {
        const mod=expr.qualifier===null?owner.module:expr.qualifier;
        if(mod!==null && !modules.includes(mod)) fail('unknown module '+mod);
        const key=(mod===null?'root':mod)+'.'+expr.name;
        const target=slots.get(key);
        if(target===undefined) fail('unresolved callable '+key);
        if(expr.qualifier!==null && mod!==owner.module && !functions[target].pub) fail('private module member '+key);
        if(expr.qualifier===null && functions[target].module!==owner.module) fail('unqualified cross-module call '+key);
        if(expr.args.length!==functions[target].params.length) fail('call arity mismatch for '+key);
        return {kind:'call',target,args:expr.args.map(a=>resolve(a,owner,depth+1))};
      }
      case 'match': return {kind:'match',subject:resolve(expr.subject,owner,depth+1),
        arms:expr.arms.map(arm=>({value:arm.value,body:resolve(arm.body,owner,depth+1)}))};
      default: fail('unsupported expression node');
    }
  }
  const resolved=functions.map(fn=>({...fn,body:resolve(fn.body,fn)}));
  const graph=resolved.map(()=>new Set());
  function inspect(expr,owner) {
    if(expr.kind==='call') {graph[owner].add(expr.target);expr.args.forEach(a=>inspect(a,owner));}
    else if(expr.kind==='binary') {inspect(expr.left,owner);inspect(expr.right,owner);}
    else if(expr.kind==='neg') inspect(expr.inner,owner);
    else if(expr.kind==='match') {
      inspect(expr.subject,owner);expr.arms.forEach(a=>inspect(a.body,owner));
    }
  }
  resolved.forEach((f,i)=>inspect(f.body,i));
  // Conservative until there is a fuel/call-depth budget: matches may contain
  // conditional recursion, but rejecting cycles is safer than permitting an
  // unbounded JS stack explosion. This is NOT an Oreslang language restriction.
  const colors=new Uint8Array(resolved.length);
  function visit(i) {
    if(colors[i]===1) fail('recursive call graph unsupported pending fuel budget');
    if(colors[i]===2) return;
    colors[i]=1;for(const j of graph[i])visit(j); colors[i]=2;
  }
  resolved.forEach((_,i)=>visit(i));
  return {modules,functions:resolved};
}
function emitProgram(program) {
  const out=[
    '// experimental Oreslang program-v2, provisional signed-64 integer model',
    'function _check(v){if(typeof v!=="bigint"||v<-(1n<<63n)||v>(1n<<63n)-1n)throw new TypeError("Oreslang signed i64 BigInt required");return v;}'
  ];
  function emitExpr(expr,depth=0) {
    if(depth > MAX_DEPTH) fail('codegen depth exceeded');
    switch(expr.kind) {
      case 'int': return expr.value+'n';
      case 'param':return '_p'+expr.index;
      case 'neg':return 'BigInt.asIntN(64,-('+emitExpr(expr.inner,depth+1)+'))';
      case 'binary':return 'BigInt.asIntN(64,('+emitExpr(expr.left,depth+1)+')'+expr.op+'('+emitExpr(expr.right,depth+1)+'))';
      case 'call':return '_f'+expr.target+'('+expr.args.map(x=>emitExpr(x,depth+1)).join(',')+')';
      case 'match': {
        // _subject is evaluated exactly once. A branch returns immediately,
        // so no fallthrough and unmatched arm expressions stay lazy.
        const lines=['(()=>{const _subject='+emitExpr(expr.subject,depth+1)+';switch(_subject){'];
        expr.arms.forEach(arm=>{
          lines.push(arm.value===null?'default:':'case '+arm.value+'n:');
          lines.push('return '+emitExpr(arm.body,depth+1)+';');
        });
        lines.push('}})()');
        return lines.join('');
      }
      default: fail('unsupported codegen expression');
    }
  }
  program.functions.forEach((fn,i)=>{
    const params=fn.params.map((_,j)=>'_p'+j);
    out.push('function _f'+i+'('+params.join(',')+'){');
    params.forEach(p=>out.push('_check('+p+');'));
    out.push('return '+emitExpr(fn.body)+';','}');
  });
  program.modules.forEach((module,i)=>{
    out.push('const _module'+i+'=Object.create(null);');
    program.functions.forEach((fn,j)=>{
      if(fn.module===module&&fn.pub) out.push('Object.defineProperty(_module'+i+','+JSON.stringify(fn.name)+',{value:_f'+j+',enumerable:true,configurable:false,writable:false});');
    });
    out.push('Object.freeze(_module'+i+');');
    out.push('export { _module'+i+' as '+JSON.stringify(module)+' };');
  });
  program.functions.forEach((fn,i)=>{
    if(fn.module===null&&fn.pub)out.push('export { _f'+i+' as '+JSON.stringify(fn.name)+' };');
  });
  return out.join('\n')+'\n';
}
export function compileProgramV2(source) {
  return emitProgram(resolveProgram(new Parser(tokenize(source)).parse()));
}
export function checkProgramV2(source) {
  compileProgramV2(source);
  return true;
}
