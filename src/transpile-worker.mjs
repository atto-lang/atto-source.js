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
    const match = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(tail);
    if (match) { i += match[0].length; continue; }
    // Only the four exceptional-control words may consume a contiguous bang.
    // Never widen arbitrary identifiers to name!; preserve != / !eq boundaries.
    // Full effects stay fail-closed in this trusted checked-Result subset.
    const bang=/^(?:trap|throw|raise|panic)!/.exec(tail);
    if(bang && tail[bang[0].length]!=='=' &&
        !/^eq(?![A-Za-z_0-9])/.test(tail.slice(bang[0].length))) {
      tokens.push(bang[0]);
      if(tokens.length>MAX_TOKENS)throw new TranspileError('E_TOKEN_LIMIT');
      i+=bang[0].length;
      continue;
    }
    const token = /^(?:"(?:\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|[^"\\\x00-\x1f])*"|->|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[(){}:;,+*\-.=<>?])/.exec(tail);
    if (!token) throw new TranspileError('E_UNSUPPORTED_TOKEN');
    tokens.push(token[0]);
    if (tokens.length > MAX_TOKENS) throw new TranspileError('E_TOKEN_LIMIT');
    i += token[0].length;
  }
  return tokens;
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
  const tokens=tokenize(source);
  reject_unsupported_mutex_constructor(tokens);
  return tokens;
}
export function transpile_to_worker(source) {
  const tokens=checked_tokens(source);
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
  // Every admitted inline body has a statically proven non-suspending scalar type.
  const result_type=node=>node?.kind==='inline_task'?node.payload_type:'int';
  let inline_count=0;
  const parse_expression=(min_prec=0,depth=0,discard_inline=false)=>{
    if(depth>=MAX_DEPTH)throw new TranspileError('E_NESTING_LIMIT');
    let left;
    if(peek()==='('){i++;left=parse_expression(0,depth+1);expect(')');}
    else if(peek()==='sync'){
      // Inline on the caller, without a child Future, TaskId or worker admission.
      // Only pure i64 expressions/empty void bodies are admitted by this parser.
      i++;expect('task');
      if(++inline_count>64)throw new TranspileError('E_TASK_LIMIT');
      let declared=null;
      if(peek()==='<'){
        i++;declared=tokens[i++];
        // A do-sync task is a void-only statement, never a discarded T.
        if(discard_inline&&declared!=='void')
          throw new TranspileError('E_TASK_RETURN_TYPE');
        if(declared!=='int'&&declared!=='void')
          throw new TranspileError('E_TASK_UNSUPPORTED');
        expect('>');
      }
      expect('{');
      let body=null;
      if(peek()==='return'){
        i++;
        // Bare return exits a void inline body; return expr produces T.
        if(peek()===';')i++;
        else{
          body=parse_expression(0,depth+1);
          if(result_type(body)!=='int')throw new TranspileError('E_TASK_RETURN_TYPE');
          expect(';');
        }
      }
      expect('}');
      const actual=body===null?'void':'int';
      if(declared!==null&&declared!==actual)
        throw new TranspileError('E_TASK_RETURN_TYPE');
      left={kind:'inline_task',payload_type:actual,body};
    }
    else if(peek()==='-'){
      i++;
      if(/^\d+$/.test(peek()??'') && checked_decimal(peek(),INT_MAX+1n)===INT_MAX+1n) {left={value:INT_MIN};i++;}
      else {const arg=parse_expression(3,depth+1);
        if(result_type(arg)!=='int')throw new TranspileError('E_TASK_RETURN_TYPE');
        left={op:'neg',arg};}
    }
    else if(/^\d+$/.test(peek()??'')){
      const value=checked_decimal(tokens[i++]);
      left={value};
    } else throw new TranspileError('E_UNSUPPORTED_EXPRESSION');
    const precedence={'+':1,'-':1,'*':2};
    while(Object.hasOwn(precedence,peek()) && precedence[peek()]>=min_prec){
      if(result_type(left)!=='int')throw new TranspileError('E_TASK_RETURN_TYPE');
      const op=tokens[i++];
      const right=parse_expression(precedence[op]+1,depth+1);
      if(result_type(right)!=='int')throw new TranspileError('E_TASK_RETURN_TYPE');
      left={op,left,right};
    }
    return left;
  };
  // Discarded inline task expressions require an explicit 'do' statement.
  // Bare 'sync task { ... }' is an expression, not a statement.
  // Spawned 'do task' / 'await task' still require a real scheduler.
  const preludes=[];
  while(peek()==='do'){
    i++;
    if(peek()!=='sync')throw new TranspileError('E_TASK_UNSUPPORTED');
    const item=parse_expression(0,0,true);
    if(item.kind!=='inline_task')throw new TranspileError('E_TASK_UNSUPPORTED');
    if(item.payload_type!=='void')throw new TranspileError('E_TASK_RETURN_TYPE');
    preludes.push(item);
    if(peek()===';')i++;
    else if(!['return','do'].includes(peek())) {
      if(peek()==='sync'&&tokens[i+1]==='task')
        throw new TranspileError('E_SYNTAX');
      throw new TranspileError('E_UNSUPPORTED_SYNTAX');
    }
  }
  if(peek()==='sync'&&tokens[i+1]==='task')
    throw new TranspileError('E_SYNTAX');
  expect('return');
  const ast=parse_expression();
  if(result_type(ast)!=='int')throw new TranspileError('E_TASK_RETURN_TYPE');
  expect(';');expect('}');
  if(i!==tokens.length)throw new TranspileError('E_TRAILING_SOURCE');
  const emit=node=>{
    if(node.kind==='inline_task')
      return node.body===null?'(()=>{})()':'(()=>{return '+emit(node.body)+';})()';
    if(Object.hasOwn(node,'value'))return `${node.value}n`;
    if(node.op==='neg')return `checked(-(${emit(node.arg)}))`;
    const op=node.op;
    return `checked((${emit(node.left)}) ${op} (${emit(node.right)}))`;
  };
  const prelude_code=preludes.map(node=>'  '+emit(node)+';\n').join('');
  const code=`// Generated by AttoLang JS subset backend; no eval or source passthrough.\n`+
    `const MAX=9223372036854775807n,MIN=-9223372036854775808n;\n`+
    `function checked(n){if(n<MIN||n>MAX)throw new Error('E_GUEST_PANIC_1');return n;}\n`+
    `export async function create_tenant({tenant,generation}){\n`+
    ` let executed=false;return {async on_message(){\n`+
    `  if(executed)throw new Error('E_MAIN_ALREADY_CALLED');executed=true;\n`+
    prelude_code+
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
    const magnitude=BigInt(token);
    if(magnitude>(negative?INT_MAX+1n:INT_MAX))
      throw new TranspileError('E_INT_OVERFLOW');
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
  expect('return');expect(';');expect('}');expect('end');
  if(peek()==='pub')i++;
  expect('fnc');expect('main');expect('(');expect(')');expect(':');
  expect('int');expect('{');expect('val');
  identifier(); // The local actor binding is not exposed to JavaScript.
  expect('=');expect('spawn');expect(actor);expect('(');expect(')');
  expect(';');expect('return');
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
export function compile_durable_counter_actor_v1(source) {
  const tokens=checked_tokens(source);
  let i=0;
  const fail=()=>{throw new TranspileError('E_DURABLE_COUNTER_ACTOR_ABI');};
  const expect=t=>{if(tokens[i++]!==t)fail();};
  const id=()=>{
    const t=tokens[i++];
    if(!/^[A-Za-z_][A-Za-z_0-9]*$/.test(t??'') ||
       ['self','define','durable','persistent','actor','as','state','receive','int','void','end','return','let','val','pub','fnc','true','false','sync','susp','await','new'].includes(t))fail();
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
