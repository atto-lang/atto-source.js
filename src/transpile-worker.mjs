import {missingBangKeywordSeparator} from './bang-keyword-separator.mjs';
import { transpile_result_int_parse_tokens } from './result-int-parse-compiler.mjs';
// Deliberately a strict AttoLang subset, not the full frontend.
// Unsupported syntax MUST fail closed. Never splice source into generated JS.
const MAX_SOURCE = 64 * 1024;
const MAX_TOKENS = 4096;
const MAX_DEPTH = 64;
const INT_MAX = 9223372036854775807n;
const INT_MIN = -9223372036854775808n;
export class TranspileError extends Error {
  constructor(code) { super(code); this.name = 'TranspileError'; this.code = code; }
}
// Bound decimal work before creating BigInt. Long padded zeros are safe:
// only the significant suffix is converted after signed-i64 range checking.
function checked_decimal(token, ceiling=INT_MAX) {
  const significant=token.replace(/^0+/, '') || '0';
  const bound=ceiling.toString();
  if(significant.length>bound.length||
     (significant.length===bound.length && significant>bound))
    throw new TranspileError('E_INT_OVERFLOW');
  return BigInt(significant);
}
function tokenize(source) {
  const tokens = [];
  let i=0;
  while (i < source.length) {
    const tail = source.slice(i);
    const match = /^(?:[\s\u0085]+|\/\/[^\r\n\u0085\u2028\u2029]*|\/\*[\s\S]*?\*\/)/.exec(tail);
    if (match) { i += match[0].length; continue; }
    const contextualWord = /^[A-Za-z_][A-Za-z_0-9]*/.exec(tail)?.[0];
    if (contextualWord && missingBangKeywordSeparator(contextualWord, tail.slice(contextualWord.length)))
      throw new TranspileError('E_BANG_KEYWORD_WHITESPACE');
    // Only the four exceptional-control words may consume a contiguous bang.
    // Never widen arbitrary identifiers to name!; preserve != / !eq boundaries.
    // Full effects stay fail-closed in this trusted checked-Result subset.
    const bang=/^(?:trap|throw|raise|panic)!/.exec(tail);
    if(bang&&tail[bang[0].length]==='=')throw new TranspileError('E_UNSUPPORTED_TOKEN');
    if(bang && tail[bang[0].length]!=='=' &&
        !/^eq(?![A-Za-z_0-9])/.test(tail.slice(bang[0].length))) {
      if(!/^[ \t\r\n\v\f]$/.test(tail[bang[0].length]??''))
        throw new TranspileError('E_BANG_KEYWORD_WHITESPACE');
      tokens.push(bang[0]);
      if(tokens.length>MAX_TOKENS)throw new TranspileError('E_TOKEN_LIMIT');
      i+=bang[0].length;
      continue;
    }
    const token = /^(?:"(?:\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|[^"\\\x00-\x1f])*"|->|<<<|>>>|<<|>>|\^\^=|\^\^|&&|\|\||==|!=|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[(){}:;,+*\-.=<>?^&|])/.exec(tail);
    if (!token) throw new TranspileError('E_UNSUPPORTED_TOKEN');
    tokens.push(token[0]);
    if (tokens.length > MAX_TOKENS) throw new TranspileError('E_TOKEN_LIMIT');
    i += token[0].length;
  }
  return tokens;
}
// Only split shift-like closers in recognized type contexts. Never join
// spaced operator tokens or reinterpret << / >> as arithmetic.
function normalize_generic_closers(tokens) {
  const nominal=new Set(['task','Mutex','Option','Future','Result','Map','Channel','ActorMail']);
  const out=[];let depth=0;
  for(const token of tokens){
    // Constructor payload bindings are angle-delimited but are not generic
    // type tests. Preserve the Result parser's nested-pattern diagnostics.
    const nominalPattern=out.at(-3)==='on'&&out.at(-2)==='is'&&['Ok','Err','Some','None'].includes(out.at(-1));
    if(token==='<'&&(depth>0||nominal.has(out.at(-1))||nominalPattern)){depth++;out.push(token);}
    else if(depth>0&&['>','>>','>>>'].includes(token)){
      const closers=Math.min(depth,token.length);
      for(let j=0;j<closers;j++)out.push('>');
      depth-=closers;
      const remainder=token.slice(closers);
      if(remainder)out.push(remainder);
    }else out.push(token);
  }
  return out;
}
// This restricted compiler has no guest mutex/lease implementation. Still
// diagnose the stable nominal resource constructor grammar before lowering.
// These are lexer tokens (comments/whitespace omitted), not regexes on raw
// attacker-controlled source, and checking does not grant any runtime access.
function reject_unsupported_mutex_constructor(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== 'Mutex' || tokens[i + 1] !== '<') continue;
    let depth = 0, end = -1;
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j] === '<') depth++;
      if (tokens[j] === '>') {
        depth--;
        if (depth === 0) { end = j; break; }
        if (depth < 0) break;
      }
    }
    if (end < 0 || tokens[end + 1] !== '(') continue; // type, not constructor
    if (tokens[i - 1] !== 'new') throw new TranspileError('E_NEW_REQUIRED');
    throw new TranspileError('E_LOCK_UNSUPPORTED');
  }
}
function checked_tokens(source) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > MAX_SOURCE) throw new TranspileError('E_SOURCE_LIMIT');
  // Raw terminal controls and NUL must not be hidden in comments or
  // visually interfere with reviewing source code before compilation.
  for (let offset = 0; offset < source.length; offset++) {
    const code = source.charCodeAt(offset);
    if (code === 0 || code === 0x1b || code === 0x7f)
      throw new TranspileError('E_RAW_SOURCE_CONTROL');
    // TextEncoder replaces lone surrogates with U+FFFD. Reject the raw
    // source instead of silently changing its contents (including comments).
    if (code >= 0xd800 && code <= 0xdbff) {
      const tail = source.charCodeAt(offset + 1);
      if (tail < 0xdc00 || tail > 0xdfff || Number.isNaN(tail))
        throw new TranspileError('E_INVALID_UTF16');
      offset++; // An intact surrogate pair denotes one valid scalar value.
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TranspileError('E_INVALID_UTF16');
    }
  }
  // Inspect the raw source before the lexer discards comments.
  // Trojan Source controls can reorder displayed source invisibly.
  if (/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(source))
    throw new TranspileError('E_BIDI_CONTROL');
  const tokens=normalize_generic_closers(tokenize(source));
  reject_unsupported_mutex_constructor(tokens);
  return tokens;
}
export function transpile_to_worker(source) {
  const tokens=checked_tokens(source);
  if(tokens.includes('<<')||tokens.includes('>>'))throw new TranspileError('E_IO_UNSUPPORTED');
  if(tokens[0]==='define')return transpile_actor_tokens(tokens);
  if(tokens.includes('Result')||tokens.includes('match')||tokens.includes('parse')) {
    try { return transpile_result_int_parse_tokens(tokens); }
    catch (error) {
      // Preserve the backend's stable diagnostic class and code contract.
      if(typeof error?.code==='string') throw new TranspileError(error.code);
      throw error;
    }
  }
  let i=0;
  const peek=()=>tokens[i];
  const expect=token=>{if(tokens[i++]!==token)throw new TranspileError('E_UNSUPPORTED_SYNTAX');};
  if (peek()==='pub') i++;
  expect('fnc'); expect('main'); expect('('); expect(')'); expect(':'); expect('int'); expect('{');
  // The restricted worker subset has only typed primitive lexical slots.
  // The emitted identifiers are compiler-generated; user spellings never enter JS.
  let inline_count=0, next_slot=0;
  const scopes=[new Map()];
  const result_type=node=>node.type;
  const lookup=name=>{
    for(let j=scopes.length-1;j>=0;j--)if(scopes[j].has(name))return scopes[j].get(name);
    throw new TranspileError('E_UNBOUND');
  };
  const reserved=new Set(['let','val','int','bool','void','true','false','return','sync','task','do','if','then','else','fi','await','defer','new','match','spawn','end','fnc','pub','trap','throw','raise','panic','AND','OR','XOR','eq','!eq']);
  const identifier=()=>{
    const n=tokens[i++];
    if(!/^[A-Za-z_][A-Za-z_0-9]*$/.test(n??'')||reserved.has(n))
      throw new TranspileError('E_UNSUPPORTED_SYNTAX');
    return n;
  };
  const fail_type=()=>{throw new TranspileError('E_TASK_RETURN_TYPE');};
  const typed=(node,type)=>{if(result_type(node)!==type)fail_type();return node;};
  const precedence={'||':0,'OR':0,'&&':2,'AND':2,'XOR':1,'|':3,'^^':4,'&':5,'==':6,'!=':6,'eq':6,'<<<':7,'>>>':7,'+':8,'-':8,'*':9};
  const parse_expression=(min_prec=0,depth=0,discard_inline=false)=>{
    if(depth>=MAX_DEPTH)throw new TranspileError('E_NESTING_LIMIT');
    let left;
    if(peek()==='('){i++;left=parse_expression(0,depth+1);expect(')');}
    else if(peek()==='sync'){
      i++;expect('task');
      if(++inline_count>64)throw new TranspileError('E_TASK_LIMIT');
      let declared=null;
      if(peek()==='<'){
        i++;declared=tokens[i++];
        if(discard_inline&&declared!=='void')fail_type();
        if(!['int','bool','void'].includes(declared))throw new TranspileError('E_TASK_UNSUPPORTED');
        expect('>');
      }
      expect('{');
      scopes.push(new Map());
      let steps,body=null;
      try {
        steps=parse_steps(depth+1);
        if(peek()==='return'||peek()==='^'){
          i++;
          if(peek()===';')i++;
          else{
            body=parse_expression(0,depth+1);
            if(discard_inline||body.type==='void')fail_type();
            expect(';');
          }
        }
        expect('}');
      } finally {scopes.pop();}
      const actual=body===null?'void':body.type;
      if(declared!==null&&declared!==actual)fail_type();
      left={kind:'inline_task',payload_type:actual,type:actual,steps,body};
    }
    else if(peek()==='if'){
      i++;const condition=typed(parse_expression(0,depth+1),'bool');expect('then');
      const yes=parse_expression(0,depth+1);expect('else');const no=parse_expression(0,depth+1);expect('fi');
      if(yes.type==='void'||yes.type!==no.type)fail_type();
      left={kind:'choose',condition,yes,no,type:yes.type};
    }
    else if(peek()==='-'){
      i++;
      if(/^\d+$/.test(peek()??'') && checked_decimal(peek(),INT_MAX+1n)===INT_MAX+1n) {left={value:INT_MIN,type:'int'};i++;}
      else {const arg=typed(parse_expression(10,depth+1),'int');left={op:'neg',arg,type:'int'};}
    }
    else if(/^\d+$/.test(peek()??'')){
      const value=checked_decimal(tokens[i++]);left={value,type:'int'};
    }else if(peek()==='true'||peek()==='false'){
      left={kind:'bool',value:tokens[i++]==='true',type:'bool'};
    }else if(peek()==='Xor'&&tokens[i+1]==='('){
      i++;expect('(');
      const lhs=typed(parse_expression(0,depth+1),'bool');expect(',');
      const rhs=typed(parse_expression(0,depth+1),'bool');expect(')');
      left={kind:'boolop',op:'XOR',left:lhs,right:rhs,type:'bool'};
    }else if(/^[A-Za-z_][A-Za-z_0-9]*$/.test(peek()??'')&&!reserved.has(peek())){
      const slot=lookup(tokens[i++]);left={kind:'local',slot:slot.id,type:slot.type};
    }else throw new TranspileError('E_UNSUPPORTED_EXPRESSION');
    while(Object.hasOwn(precedence,peek()) && precedence[peek()]>=min_prec){
      const prec=precedence[peek()];
      const op=tokens[i++];
      const right=parse_expression(prec+1,depth+1);
      if(['&&','||','AND','OR','XOR'].includes(op)){
        typed(left,'bool');typed(right,'bool');
        left={kind:'boolop',op,left,right,type:'bool'};
      }else if(['==','!=','eq'].includes(op)){
        if(left.type==='void'||left.type!==right.type)fail_type();
        left={kind:'compare',op,left,right,type:'bool'};
      }else{
        // Canonical punctuation XOR is integer-only; named Xor is Boolean.
        typed(left,'int');typed(right,'int');left={op,left,right,type:'int'};
      }
    }
    if(min_prec===0&&peek()==='?'){
      i++;const condition=typed(left,'bool');const yes=parse_expression(0,depth+1);
      expect(':');const no=parse_expression(0,depth+1);
      if(yes.type==='void'||yes.type!==no.type)fail_type();
      left={kind:'choose',condition,yes,no,type:yes.type};
    }
    return left;
  };
  function parse_steps(depth){
    if(depth>=MAX_DEPTH)throw new TranspileError('E_NESTING_LIMIT');
    const out=[];
    while(true){
      if(peek()==='let'||peek()==='val'){
        const mutable=tokens[i++]==='let';
        const declared=['int','bool'].includes(peek())?tokens[i++]:null;
        const name=identifier();
        if(scopes.at(-1).has(name))throw new TranspileError('E_DUPLICATE_LOCAL');
        expect('=');const init=parse_expression(0,depth+1);expect(';');
        if(init.type==='void'||(declared!==null&&declared!==init.type))fail_type();
        const slot={id:next_slot++,type:init.type,mutable};
        scopes.at(-1).set(name,slot);out.push({kind:'bind',slot:slot.id,mutable,init});
      }else if(tokens[i+1]==='='||tokens[i+1]==='^^='){
        const slot=lookup(identifier());
        if(!slot.mutable)throw new TranspileError('E_IMMUTABLE_ASSIGNMENT');
        const compound=peek()==='^^=';
        if(compound&&slot.type!=='int')fail_type();
        expect(compound?'^^=':'=');
        const rhs=typed(parse_expression(0,depth+1),slot.type);expect(';');
        const value=compound?{op:'^^',left:{kind:'local',slot:slot.id,type:'int'},right:rhs,type:'int'}:rhs;
        out.push({kind:'set',slot:slot.id,value});
      }else if(peek()==='do'){
        i++;if(peek()!=='sync')throw new TranspileError('E_TASK_UNSUPPORTED');
        const item=parse_expression(0,depth+1,true);
        if(item.kind!=='inline_task')throw new TranspileError('E_TASK_UNSUPPORTED');
        typed(item,'void');out.push({kind:'expr',value:item});
        if(peek()===';')i++;
        else if(!['return','^','do','}'].includes(peek())){
          if(peek()==='sync'&&tokens[i+1]==='task')throw new TranspileError('E_SYNTAX');
          throw new TranspileError('E_UNSUPPORTED_SYNTAX');
        }
      }else break;
    }
    if(peek()==='sync'&&tokens[i+1]==='task')throw new TranspileError('E_SYNTAX');
    return out;
  }
  const preludes=parse_steps(0);
  if(peek()==='^')i++;else expect('return');
  const ast=typed(parse_expression(),'int');
  expect(';');expect('}');
  if(i!==tokens.length)throw new TranspileError('E_TRAILING_SOURCE');
  let uses_shift=false;
  const emit=node=>{
    if(node.kind==='inline_task')
      return '(()=>{'+node.steps.map(emit_step).join('')+
        (node.body===null?'':'return '+emit(node.body)+';')+'})()';
    if(node.kind==='local')return '_v'+node.slot;
    if(node.kind==='bool')return node.value?'true':'false';
    if(node.kind==='choose')return '(('+emit(node.condition)+')?('+emit(node.yes)+'):('+emit(node.no)+'))';
    if(node.kind==='compare')return '(('+emit(node.left)+')'+(node.op==='!='?'!==':'===')+'('+emit(node.right)+'))';
    if(node.kind==='boolop'){
      const op=['&&','AND'].includes(node.op)?'&&':['||','OR'].includes(node.op)?'||':'!==';
      return '(('+emit(node.left)+')'+op+'('+emit(node.right)+'))';
    }
    if(Object.hasOwn(node,'value'))return `${node.value}n`;
    if(node.op==='neg')return `checked(-(${emit(node.arg)}))`;
    const op=node.op;
    const left=emit(node.left),right=emit(node.right);
    if(op==='<<<'||op==='>>>'){
      uses_shift=true;
      const static_count=Object.hasOwn(node.right,'value')?node.right.value:
        node.right.op==='neg'&&Object.hasOwn(node.right.arg,'value')?-node.right.arg.value:null;
      if(static_count!==null&&(static_count<0n||static_count>63n))
        throw new TranspileError('E_SHIFT_DISTANCE');
      return op==='<<<'
        ? 'BigInt.asIntN(64, ('+left+') << checked_shift('+right+'))'
        : 'BigInt.asIntN(64, BigInt.asUintN(64, ('+left+')) >> checked_shift('+right+'))';
    }
    return 'checked(('+left+') '+(op==='^^'?'^':op)+' ('+right+'))';
  };
  const emit_step=node=>{
    if(node.kind==='bind')return (node.mutable?'let ':'const ')+'_v'+node.slot+'='+emit(node.init)+';';
    if(node.kind==='set')return '_v'+node.slot+'='+emit(node.value)+';';
    return emit(node.value)+';';
  };
  const prelude_code=preludes.map(node=>'  '+emit_step(node)+'\n').join('');
  const result_code=emit(ast);
  const code=`// Generated by AttoLang JS subset backend; no eval or source passthrough.\n`+
    `const MAX=9223372036854775807n,MIN=-9223372036854775808n;\n`+
    `function checked(n){if(n<MIN||n>MAX)throw new Error('E_GUEST_PANIC_1');return n;}\n`+
    (uses_shift?`function checked_shift(n){if(n<0n||n>63n)throw new Error('E_GUEST_SHIFT_DISTANCE');return n;}\n`:'')+
    `export async function create_tenant({tenant,generation}){\n`+
    ` let executed=false;return {async on_message(){\n`+
    `  if(executed)throw new Error('E_MAIN_ALREADY_CALLED');executed=true;\n`+
    prelude_code+
    `  return {value:String(${result_code}),stdout:'',actors:0};\n`+
    ` }};\n}\n`;
  return {backend:'js',trusted:true,guest_abi:'atto.js.browser.subset.v1',module_source:code};
}


// Fail-closed, executable slice of Atto actor receivers.
// The admitted shape matches the Rust browser remote-actor-receiver fixture:
// a single actor with one signed-i64 state field, additive ActorMail<int>
// receive, println, and main spawning exactly one actor. No JS source eval,
// arbitrary guest expressions, or implicit widening of the language grammar.
function transpile_actor_tokens(tokens) {
  let i=0;
  const peek=()=>tokens[i];
  const expect=token=>{
    if(tokens[i++]!==token)throw new TranspileError('E_UNSUPPORTED_ACTOR_SYNTAX');
  };
  const identifier=()=>{
    const token=tokens[i++];
    if(token==='sync'||!/^[A-Za-z_][A-Za-z_0-9]*$/.test(token??''))
      throw new TranspileError('E_UNSUPPORTED_ACTOR_SYNTAX');
    return token;
  };
  const literal=()=>{
    const negative=peek()==='-';
    if(negative)i++;
    const token=tokens[i++];
    if(!/^[0-9]+$/.test(token??''))
      throw new TranspileError('E_UNSUPPORTED_ACTOR_LITERAL');
    // Check the significant decimal digits before materializing BigInt.
    // An attacker can supply a near-MAX_SOURCE decimal literal; avoid
    // allocating a huge temporary bignum merely to reject it.
    const magnitude=checked_decimal(token,negative?INT_MAX+1n:INT_MAX);
    return negative ? -magnitude : magnitude;
  };
  expect('define');expect('actor');
  const actor=identifier();
  expect('as');expect('let');expect('int');
  const field=identifier();
  expect('=');
  const initial=literal();
  expect(';');expect('receive');expect('(');
  expect('ActorMail');expect('<');expect('int');expect('>');
  const mail=identifier();
  expect(')');expect(':');expect('void');expect('{');
  expect('self');expect('.');expect(field);expect('=');
  expect('self');expect('.');expect(field);expect('+');
  expect(mail);expect('.');expect('value');expect(';');
  expect('stdio');expect('.');expect('println');expect('(');
  expect('self');expect('.');expect(field);expect(')');expect(';');
  if(peek()==='^')i++;else expect('return');expect(';');expect('}');expect('end');
  if(peek()==='pub')i++;
  expect('fnc');expect('main');expect('(');expect(')');expect(':');
  expect('int');expect('{');expect('val');
  identifier(); // The local actor binding is not exposed to JavaScript.
  expect('=');expect('spawn');expect(actor);expect('(');expect(')');
  expect(';');if(peek()==='^')i++;else expect('return');
  const main_value=literal();
  expect(';');expect('}');
  if(i!==tokens.length)throw new TranspileError('E_TRAILING_SOURCE');
  const code=[
    '// Generated by AttoLang checked-i64 actor subset; trusted JS only.',
    'const MAX=9223372036854775807n,MIN=-9223372036854775808n;',
    "function checked(n){if(n<MIN||n>MAX)throw new Error('E_GUEST_PANIC_1');return n;}",
    'export async function create_tenant({tenant,generation}){',
    ' let initialized=false;',
    ' let total='+initial+'n;',
    ' return {',
    '  async on_message(){',
    "   if(initialized)throw new Error('E_MAIN_ALREADY_CALLED');",
    '   initialized=true;',
    "   return {value:'"+main_value+"',stdout:'',actors:1};",
    '  },',
    '  async on_route({actor_id,wire_type,buffer}){',
    "   if(!initialized)throw new Error('E_GUEST_NOT_READY');",
    "   if(actor_id!==1)throw new Error('E_ACTOR_REF');",
    "   if(wire_type!=='i64'||!(buffer instanceof ArrayBuffer)||buffer.byteLength!==8)",
    "    throw new Error('E_ROUTE_WIRE');",
    '   try {',
    '    const next=checked(total+new DataView(buffer).getBigInt64(0,true));',
    '    total=next;',
    "    return {value:'delivered',stdout:String(total)+'\\n',actors:1};",
    '   } catch(error) {',
    "    if(error?.message==='E_GUEST_PANIC_1')",
    "     error.actor_failure={kind:'panic',actor_id:1,parent_id:0,actor_type:'"+actor+"',reason:'E_GUEST_PANIC_1'};",
    '    throw error;',
    '   }',
    '  }',
    ' };',
    '}',
    ''
  ].join('\n');
  return {backend:'js',trusted:true,guest_abi:'atto.js.browser.actor-subset.v1',module_source:code};
}

// Opt-in broker-only profile, identical bounded transition domain to Rust
// --durable-counter-actor-v1. It never creates a volatile worker actor.
// Reserved source words must not become state-schema identities merely because
// this bounded profile erases identifiers before guest emission. Keep the
// Rust parser's unconditional keyword floor; do not reserve contextual names.
const DURABLE_COUNTER_RESERVED_NAMES = new Set([
  "abstract", "actor", "arr", "as", "async", "await", "begin", "block", "break",
  "catch", "cb", "class", "conforms", "const", "continue", "contract", "cpu", "def",
  "default", "defer", "define", "do", "done", "durable", "elif", "else", "elseif",
  "end", "eq", "extends", "false", "fi", "finally", "fnc", "for", "from",
  "generator", "gpu", "guard", "if", "impl", "implements", "import", "int", "interface",
  "is", "isoactor", "let", "loop", "match", "matches", "maybe", "module", "mut",
  "namespace", "nb", "neq", "new", "nlex", "null", "obj", "of", "over",
  "panic", "persistent", "pipe", "private", "pub", "pure", "quantum", "raise", "readch",
  "receive", "recover", "return", "routine", "rpipe", "rt", "select", "self", "shared",
  "spawn", "state", "static", "stop", "struct", "super", "susp", "suspends", "switch",
  "sync", "task", "then", "throw", "trait", "trap", "true", "try", "type",
  "typeof", "types", "unsafe", "untrusted", "using", "val", "void", "while", "writech",
  "yield",
]);
export function compile_durable_counter_actor_v1(source) {
  const tokens=checked_tokens(source);
  let i=0;
  const fail=()=>{throw new TranspileError('E_DURABLE_COUNTER_ACTOR_ABI');};
  const expect=t=>{if(tokens[i++]!==t)fail();};
  const id=()=>{
    const t=tokens[i++];
    if(!/^[A-Za-z_][A-Za-z_0-9]*$/.test(t??'') ||
       DURABLE_COUNTER_RESERVED_NAMES.has(t))fail();
    return t;
  };
  expect('define');expect('durable');expect('actor');expect('Counter');expect('as');
  expect('state');const field=id();expect(':');expect('int');expect('=');expect('0');expect(';');
  expect('receive');expect('(');expect('ActorMail');expect('<');expect('int');expect('>');
  const mail=id();expect(')');expect('->');expect('void');expect('{');
  expect('self');expect('.');expect(field);expect('=');expect('self');expect('.');expect(field);
  expect('+');expect(mail);expect('.');expect('value');expect(';');expect('}');expect('end');
  if(i!==tokens.length)fail();
  const encoder=new TextEncoder(), actorBytes=encoder.encode('Counter'), fieldBytes=encoder.encode(field);
  const fnv=bytes=>{
    let h=0xcbf29ce484222325n;
    for(const b of bytes)h=BigInt.asUintN(64,(h^BigInt(b))*0x100000001b3n);
    return h;
  };
  const sized=bytes=>{
    const a=new Uint8Array(4+bytes.length);
    new DataView(a.buffer).setUint32(0,bytes.length,true);a.set(bytes,4);return a;
  };
  const schema=fnv([...encoder.encode('atto.actor.state.schema.v1'),0,...sized(actorBytes),...sized(fieldBytes),1]);
  const snapshot=new Uint8Array(36),view=new DataView(snapshot.buffer);
  snapshot.set(encoder.encode('ATTOST01'));snapshot[8]=1;
  view.setBigUint64(9,schema,true);view.setUint16(17,1,true);snapshot[19]=1;
  view.setBigUint64(28,fnv(snapshot.subarray(0,28)),true);
  const metadata=[1];
  const append=bytes=>{
    let n=bytes.length;
    do{const b=n&127;n>>>=7;metadata.push(n?b|128:b);}while(n);
    metadata.push(...bytes);
  };
  append(actorBytes);append(fieldBytes);metadata.push(1);append(snapshot);
  // Only fixed code and validated descriptor bytes are emitted. No source
  // splice, eval, dynamic imports or persistence permissions in the guest.
  const code=[
    'export function atto_durable_state_v1(){return Uint8Array.of('+metadata.join(',')+');}',
    'export function atto_durable_transition_v1(state,op,delta){',
    " if(typeof state!=='bigint'||typeof op!=='bigint'||typeof delta!=='bigint')throw new TypeError('E_DURABLE_COUNTER_ACTOR_ABI');",
    ' if(state<0n||state>1000000000n)return -1n;',
    ' if(op===2n)return delta===0n?state:-1n;',
    ' if(op!==1n||delta<=0n||delta>1000000000n||state>1000000000n-delta)return -1n;',
    ' return state+delta;',
    '}',
    ''
  ].join('\n');
  return {backend:'js',guest_abi:'atto.js.durable.counter.v1',module_source:code};
}

// Schema-only AOT checkpoint emitter; not ordinary worker admission.
export {compile_durable_scalar_codec_v1} from './durable-scalar-codec-v1.mjs';
