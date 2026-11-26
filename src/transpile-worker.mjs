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
  const offsets = [];
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
    if(bang && tail[bang[0].length]!=='=' &&
        !/^eq(?![A-Za-z_0-9])/.test(tail.slice(bang[0].length))) {
      if(!/^[ \t\r\n\v\f]$/.test(tail[bang[0].length]??''))
        throw new TranspileError('E_BANG_KEYWORD_WHITESPACE');
      tokens.push(bang[0]);
      offsets.push(i);
      if(tokens.length>MAX_TOKENS)throw new TranspileError('E_TOKEN_LIMIT');
      i+=bang[0].length;
      continue;
    }
    const token = /^(?:"(?:\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|[^"\\\x00-\x1f])*"|->|<<<|>>>|<<|>>|\^\^|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[(){}:;,+*\-.=<>!?^&|])/.exec(tail);
    if (!token) throw new TranspileError('E_UNSUPPORTED_TOKEN');
    // Bare bangs are admitted only for explicitly unlowered actor forms.
    if(token[0]==='!' && !['stop','pipe','rpipe','share'].includes(tokens.at(-1)))
      throw new TranspileError('E_UNSUPPORTED_TOKEN');
    tokens.push(token[0]);
    offsets.push(i);
    if (tokens.length > MAX_TOKENS) throw new TranspileError('E_TOKEN_LIMIT');
    i += token[0].length;
  }
  Object.defineProperty(tokens,'offsets',{value:offsets});
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
  const rawTokens=tokenize(source);
  {
    const tokens=rawTokens;
  // Continuous actor/channel/stream pipelines have no executable guest ABI in
  // this JS subset. Lex first so comments cannot accidentally authorize or
  // reject a program; preserve |> as the separate functional operator.
  if(tokens.includes('pipe') || tokens.includes('rpipe'))
    throw new TranspileError('E_UNSUPPORTED_CONTINUOUS_PIPE');

  for(let i=0;i<tokens.length;i++){
    const current=tokens[i],next=tokens[i+1];
    // Alias/imported Topic handles need no local actor.group/Topic spelling.
    // Reject before JS emission; no checked Topic/Result/share! runtime exists.
    if(current==='.'&&next==='try_publish')
      throw new TranspileError('E_ACTOR_PUBSUB_UNSUPPORTED');
    // The contextual stop! spelling is only recognized with contiguous '!'.
    // A separated operator stays an unsupported expression, not a rewritten
    // actor STOP request. Neither form has executable graceful-stop lowering.
    if(current==='stop'&&next==='!' &&
       tokens.offsets[i+1]===tokens.offsets[i]+4)
      throw new TranspileError('E_STOP_BACKEND_UNSUPPORTED');
    if(current==='.'&&(next==='get_ready'||next==='get_done')&&tokens[i+2]==='(')
      throw new TranspileError(next==='get_ready'
        ?'E_UNSUPPORTED_ACTOR_READY_FUTURE'
        :'E_UNSUPPORTED_ACTOR_DONE_FUTURE');
    if(current==='.'&&(next==='ready'||next==='done'))
      throw new TranspileError('E_UNSUPPORTED_ACTOR_LIFECYCLE_PROPERTY');
  }
  }
  const tokens=normalize_generic_closers(rawTokens);
  reject_unsupported_mutex_constructor(tokens);
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
      if(peek()==='return'||peek()==='^'){
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
      else {const arg=parse_expression(7,depth+1);
        if(result_type(arg)!=='int')throw new TranspileError('E_TASK_RETURN_TYPE');
        left={op:'neg',arg};}
    }
    else if(/^\d+$/.test(peek()??'')){
      const value=checked_decimal(tokens[i++]);
      left={value};
    } else throw new TranspileError('E_UNSUPPORTED_EXPRESSION');
    const precedence={'|':0,'^^':1,'&':2,'<<<':3,'>>>':3,'+':4,'-':4,'*':5};
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
    else if(!['return','^','do'].includes(peek())) {
      if(peek()==='sync'&&tokens[i+1]==='task')
        throw new TranspileError('E_SYNTAX');
      throw new TranspileError('E_UNSUPPORTED_SYNTAX');
    }
  }
  if(peek()==='sync'&&tokens[i+1]==='task')
    throw new TranspileError('E_SYNTAX');
  if(peek()==='^')i++;else expect('return');
  const ast=parse_expression();
  if(result_type(ast)!=='int')throw new TranspileError('E_TASK_RETURN_TYPE');
  expect(';');expect('}');
  if(i!==tokens.length)throw new TranspileError('E_TRAILING_SOURCE');
  let uses_shift=false;
  const emit=node=>{
    if(node.kind==='inline_task')
      return node.body===null?'(()=>{})()':'(()=>{return '+emit(node.body)+';})()';
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
  const prelude_code=preludes.map(node=>'  '+emit(node)+';\n').join('');
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
    const magnitude=checked_decimal(token, negative?INT_MAX+1n:INT_MAX);
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
    if(peek()==='^')i++;else expect('return');expect(';');expect('}');expect('end');
    if(peek()==='pub')i++;
    if(peek()==='susp')i++;
    expect('fnc');expect('main');expect('(');expect(')');expect(':');
    expect('int');expect('{');expect('val');
    identifier();
    expect('=');expect('spawn');expect(actor);expect('(');expect(')');
    expect(';');if(peek()==='^')i++;else expect('return');
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
  if(peek()==='^')i++;else expect('return');expect(';');expect('}');expect('end');
  if(peek()==='pub')i++;
  if(peek()==='susp')i++; // still no general async/continuation lowering
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
    ' let terminated=false;',
    ' let total='+initial+'n;',
    ' return {',
    '  async on_message(){',
    "   if(initialized)throw new Error('E_MAIN_ALREADY_CALLED');",
    '   initialized=true;',
    "   return {value:'"+main_value+"',stdout:'',actors:1};",
    '  },',
    '  async on_route({actor_id,wire_type,buffer}){',
    "   if(!initialized)throw new Error('E_GUEST_NOT_READY');",
    "   if(terminated)throw new Error('E_ACTOR_TERMINATED');",
    "   if(actor_id!==1)throw new Error('E_ACTOR_REF');",
    "   if(wire_type!=='i64'||!(buffer instanceof ArrayBuffer)||buffer.byteLength!==8)",
    "    throw new Error('E_ROUTE_WIRE');",
    '   try {',
    '    const next=checked(total+new DataView(buffer).getBigInt64(0,true));',
    '    total=next;',
    "    return {value:'delivered',stdout:String(total)+'\\n',actors:1};",
    '   } catch(error) {',
    "    if(error?.message==='E_GUEST_PANIC_1') {",
    '     terminated=true;',
    "     error.actor_failure={kind:'panic',actor_id:1,parent_id:0,actor_type:'"+actor+"',reason:'E_GUEST_PANIC_1'};",
    '    }',
    '    throw error;',
    '   }',
    '  }',
    ' };',
    '}',
    ''
  ].join('\n');
  return {backend:'js',trusted:true,guest_abi:'atto.js.browser.actor-subset.v1',module_source:code};
}
