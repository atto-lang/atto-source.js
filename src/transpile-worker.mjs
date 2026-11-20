import {compile_actor_state_counter} from './actor-state-counter.mjs';
import {transpile_result_int_parse_tokens} from './result-int-parse-compiler.mjs';
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
function tokenize(source) {
  const tokens = [];
  let i=0;
  while (i < source.length) {
    const tail = source.slice(i);
    // A line comment ends at *any* recognized source line separator, not
    // just LF. Otherwise CR/U+2028 source can be hidden from the parser.
    const match = /^(?:[\s\u0085]+|\/\/[^\r\n\u0085\u2028\u2029]*|\/\*[\s\S]*?\*\/)/.exec(tail);
    if (match) { i += match[0].length; continue; }
    // Maximal-munch disambiguation: ^ returns, ^^ bitwise XOR;
    // <<< and >>> shift, whereas << and >> are typed I/O, not shifts.
    const token = /^(?:"(?:\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|[^"\\\x00-\x1f])*"|->|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|<<<|>>>|<<|>>|\^\^|[(){}:;,+*\-.=<>?^|])/.exec(tail);
    if (!token) throw new TranspileError('E_UNSUPPORTED_TOKEN');
    tokens.push(token[0]);
    if (tokens.length > MAX_TOKENS) throw new TranspileError('E_TOKEN_LIMIT');
    i += token[0].length;
  }
  return tokens;
}
// Nested generic closers are not typed I/O shift/read operations.
function normalize_generic_closers(tokens) {
  const out=[];
  const nominal=new Set(['task','Mutex','Option','Future','Result','Map','Channel']);
  let depth=0;
  for(const token of tokens) {
    if(token==='<') {
      if(depth>0||nominal.has(out[out.length-1]))depth++;
      out.push(token);
    } else if(token==='>'&&depth>0) {
      depth--;
      out.push(token);
    } else if((token==='>>'||token==='>>>')&&depth>0) {
      for(let j=0;j<token.length;j++)out.push('>');
      depth=Math.max(0,depth-token.length);
    } else {
      out.push(token);
    }
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
export function transpile_to_worker(source) {
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
  // Read/write shorthands need typed capability and suspension lowering. This
  // narrow arithmetic guest must not reinterpret them as integer shifts.
  if(tokens.includes('<<')||tokens.includes('>>'))
    throw new TranspileError('E_IO_UNSUPPORTED');
  // Unsupported multi-actor pipelines cannot be lowered as plain expressions.
  if(tokens.includes('pipe')||tokens.includes('rpipe'))
    throw new TranspileError('E_UNSUPPORTED_CONTINUOUS_PIPE');
  reject_unsupported_mutex_constructor(tokens);
  // Sealed actor-state programs must not fall back to mutable actor-field code.
  if(tokens[0]==='define'&&tokens.includes('handle_state'))
    return compile_actor_state_counter(tokens, code=>{throw new TranspileError(code);});
  if(tokens[0]==='define')return transpile_actor_tokens(tokens);
  if(tokens.includes('Result')||tokens.includes('match')||tokens.includes('parse')) {
    try {return transpile_result_int_parse_tokens(tokens);}
    catch(error) {
      if(typeof error?.code==='string')throw new TranspileError(error.code);
      throw error;
    }
  }
  let i=0;
  const peek=()=>tokens[i];
  const expect=token=>{if(tokens[i++]!==token)throw new TranspileError('E_UNSUPPORTED_SYNTAX');};
  if (peek()==='pub') i++;
  expect('fnc'); expect('main'); expect('('); expect(')'); expect(':'); expect('int'); expect('{');
  // Canonical Atto: '^ value;' is a return statement, never power or XOR.
  if(peek()==='^')i++;else expect('return');
  const parse_expression=(min_prec=0,depth=0)=>{
    if(depth>=MAX_DEPTH)throw new TranspileError('E_NESTING_LIMIT');
    let left;
    if(peek()==='('){i++;left=parse_expression(0,depth+1);expect(')');}
    else if(peek()==='-'){
      i++;
      if(/^\d+$/.test(peek()??'') && BigInt(peek())===INT_MAX+1n) {left={value:INT_MIN};i++;}
      else left={op:'neg',arg:parse_expression(4,depth+1)};
    }
    else if(/^\d+$/.test(peek()??'')){
      const value=BigInt(tokens[i++]);
      if(value>INT_MAX)throw new TranspileError('E_INT_OVERFLOW');
      left={value};
    } else throw new TranspileError('E_UNSUPPORTED_EXPRESSION');
    // ^^ is int bitwise XOR; triple shifts bind tighter, but below arithmetic.
    // The right count is masked to 6 bits per the proposed bitwise contract.
    const precedence={'^^':0,'<<<':1,'>>>':1,'+':2,'-':2,'*':3};
    while(Object.hasOwn(precedence,peek()) && precedence[peek()]>=min_prec){
      const op=tokens[i++];
      const right=parse_expression(precedence[op]+1,depth+1);
      left={op,left,right};
    }
    return left;
  };
  const ast=parse_expression();
  expect(';');expect('}');
  if(i!==tokens.length)throw new TranspileError('E_TRAILING_SOURCE');
  const emit=node=>{
    if(Object.hasOwn(node,'value'))return `${node.value}n`;
    if(node.op==='neg')return `checked(-(${emit(node.arg)}))`;
    const left=emit(node.left),right=emit(node.right);
    // BigInt.asIntN preserves signed 64-bit *bit patterns*: shifts do not
    // raise arithmetic-overflow traps, unlike +, -, and *.
    if(node.op==='<<<')return `BigInt.asIntN(64, (${left}) << ((${right}) & 63n))`;
    if(node.op==='>>>')return `BigInt.asIntN(64, BigInt.asUintN(64, (${left})) >> ((${right}) & 63n))`;
    if(node.op==='^^')return `checked((${left}) ^ (${right}))`;
    const op=node.op;
    return `checked((${left}) ${op} (${right}))`;
  };
  const code=`// Generated by AttoLang JS subset backend; no eval or source passthrough.\n`+
    `const MAX=9223372036854775807n,MIN=-9223372036854775808n;\n`+
    `function checked(n){if(n<MIN||n>MAX)throw new Error('E_GUEST_PANIC_1');return n;}\n`+
    `export async function create_tenant({tenant,generation}){\n`+
    ` let executed=false;return {async on_message(){\n`+
    `  if(executed)throw new Error('E_MAIN_ALREADY_CALLED');executed=true;\n`+
    `  return {value:String(${emit(ast)}),stdout:'',actors:0};\n`+
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
    if(!/^[A-Za-z_][A-Za-z_0-9]*$/.test(token??''))
      throw new TranspileError('E_UNSUPPORTED_ACTOR_SYNTAX');
    return token;
  };
  const literal=()=>{
    const negative=peek()==='-';
    if(negative)i++;
    const token=tokens[i++];
    if(!/^[0-9]+$/.test(token??''))
      throw new TranspileError('E_UNSUPPORTED_ACTOR_LITERAL');
    const magnitude=BigInt(token);
    if(magnitude>(negative?INT_MAX+1n:INT_MAX))
      throw new TranspileError('E_INT_OVERFLOW');
    return negative ? -magnitude : magnitude;
  };
  expect('define');expect('actor');
  const actor=identifier();
  // Stage 1 typed ingress: the only executable actor subset has exactly one
  // ActorMail<int> handler and a checked signed-i64 worker wire. An explicit
  // receives header must describe that EXISTING handler, never widen it.
  let received=null;
  if(peek()==='receives'){
    i++;
    received=identifier();
    if(received==='never')throw new TranspileError('E_ACTOR_RECEIVES_NEVER_UNSUPPORTED');
    if(received!=='int'&&received!=='bool')throw new TranspileError('E_ACTOR_RECEIVES');
  }
  // In this exact admitted program shape the actor handler only updates its
  // scalar state and prints. There are NO application send operations, helper
  // calls, dynamic actor references or user callbacks in the accepted grammar.
  // Its statically computed outbound effect is therefore the empty set; it
  // respects any supported declared upper bound. This does NOT generalize to
  // future actor-to-actor sends without a genuine typed call-graph checker.
  if(peek()==='sends'){
    i++;
    const payload=identifier();
    if(payload==='void')throw new TranspileError('E_ACTOR_SEND_CONTRACT');
    if(!['int','bool','never'].includes(payload))
      throw new TranspileError('E_ACTOR_SENDS_EFFECT_UNSUPPORTED');
  }
  if(peek()==='sends'||peek()==='receives')
    throw new TranspileError('E_ACTOR_CONTRACT');
  if(peek()==='emits')throw new TranspileError('E_ACTOR_EMITS_EFFECT_UNSUPPORTED');
  expect('as');
  // Independent trusted-JS boolean mailbox profile. This is generated JS
  // guest execution, NOT a compiled Wasm inbox or cross-tenant capability.
  // Source grammar is deliberately exact: no host callbacks, dynamic sends,
  // generic erasure, mutable aliases or arbitrary JavaScript expressions.
  if(peek()==='let' && tokens[i+1]==='bool'){
    if(received!==null&&received!=='bool')
      throw new TranspileError('E_ACTOR_RECEIVES');
    expect('let');expect('bool');
    const field=identifier();
    expect('=');
    const initial=peek();
    if(initial!=='false'&&initial!=='true')
      throw new TranspileError('E_UNSUPPORTED_ACTOR_LITERAL');
    i++;expect(';');
    if(peek()==='susp')i++; // syntactic only, no await/resume body admitted
    expect('receive');expect('(');
    expect('ActorMail');expect('<');
    const handlerPayload=identifier();
    expect('>');
    if(handlerPayload!=='bool')throw new TranspileError('E_ACTOR_RECEIVES');
    const mail=identifier();
    expect(')');expect(':');expect('void');expect('{');
    expect('self');expect('.');expect(field);expect('=');
    expect(mail);expect('.');expect('value');expect(';');
    expect('stdio');expect('.');expect('println');expect('(');
    expect('self');expect('.');expect(field);expect(')');expect(';');
    expect('return');expect(';');expect('}');expect('end');
    if(peek()==='pub')i++;
    if(peek()==='susp')i++;
    expect('fnc');expect('main');expect('(');expect(')');expect(':');
    expect('int');expect('{');expect('val');
    identifier();
    expect('=');expect('spawn');expect(actor);expect('(');expect(')');
    expect(';');
    if(peek()==='^')i++;else expect('return');
    const main_value=literal();
    expect(';');expect('}');
    if(i!==tokens.length)throw new TranspileError('E_TRAILING_SOURCE');
    const code=[
      '// Generated by AttoLang strict boolean DATA mailbox subset; trusted JS only.',
      'export async function create_tenant({tenant,generation}){',
      ' let initialized=false;',
      ' let state='+initial+';',
      ' return {',
      '  async on_message(){',
      "   if(initialized)throw new Error('E_MAIN_ALREADY_CALLED');",
      '   initialized=true;',
      "   return {value:'"+main_value+"',stdout:'',actors:1};",
      '  },',
      '  async on_route({actor_id,wire_type,buffer}){',
      "   if(!initialized)throw new Error('E_GUEST_NOT_READY');",
      "   if(actor_id!==1)throw new Error('E_ACTOR_REF');",
      "   if(wire_type!=='bool'||!(buffer instanceof ArrayBuffer)||buffer.byteLength!==1)",
      "    throw new Error('E_ROUTE_WIRE');",
      '   const raw=new DataView(buffer).getUint8(0);',
      "   if(raw!==0&&raw!==1)throw new Error('E_ROUTE_WIRE');",
      '   state=raw===1;',
      "   return {value:'delivered',stdout:String(state)+'\\n',actors:1};",
      '  }',
      ' };',
      '}',
      ''
    ].join('\n');
    return {backend:'js',trusted:true,guest_abi:'atto.js.browser.actor-subset.v1',module_source:code};
  }
  if(received==='bool')throw new TranspileError('E_ACTOR_RECEIVES');
  expect('let');expect('int');
  const field=identifier();
  expect('=');
  const initial=literal();
  expect(';');
  if(peek()==='susp')i++; // inert marker in the fixed no-await actor subset
  expect('receive');expect('(');
  expect('ActorMail');expect('<');
  const handlerPayload=identifier();
  expect('>');
  if(handlerPayload!=='int')throw new TranspileError('E_ACTOR_RECEIVES');
  const mail=identifier();
  expect(')');expect(':');expect('void');expect('{');
  expect('self');expect('.');expect(field);expect('=');
  expect('self');expect('.');expect(field);expect('+');
  expect(mail);expect('.');expect('value');expect(';');
  expect('stdio');expect('.');expect('println');expect('(');
  expect('self');expect('.');expect(field);expect(')');expect(';');
  expect('return');expect(';');expect('}');expect('end');
  if(peek()==='pub')i++;
  if(peek()==='susp')i++; // still no general async/continuation lowering
  expect('fnc');expect('main');expect('(');expect(')');expect(':');
  expect('int');expect('{');expect('val');
  identifier(); // The local actor binding is not exposed to JavaScript.
  expect('=');expect('spawn');expect(actor);expect('(');expect(')');
  expect(';');
  if(peek()==='^')i++;else expect('return');
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
