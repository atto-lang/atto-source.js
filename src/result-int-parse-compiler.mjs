// STRICT typed AttoLang Result<int,Error> -> JS Worker guest compiler profile.
// Compiler-generated JS executes only in the trusted Worker backend. It is NOT
// proof of hostile code isolation in one OS process, nor generic ADT parity.
const MAX = 9223372036854775807n, MIN = -9223372036854775808n;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function id(token) {
  if (!/^[a-z_][a-z_0-9]*$/.test(token ?? '') || token === 'int')
    fail('E_BINDER');
  return token;
}
function value(token) {
  if (!/^"(?:[\s\S]*)"$/.test(token ?? '')) fail('E_TYPE');
  try {
    const text = JSON.parse(token);
    if (typeof text !== 'string') fail('E_TYPE');
    // JSON permits escaped lone surrogates; reject silently lossy UTF-8.
    for (let i=0; i<text.length; i++) {
      const c=text.charCodeAt(i);
      if(c>=0xd800 && c<=0xdbff) {
        const d=text.charCodeAt(++i);
        if(!(d>=0xdc00 && d<=0xdfff)) fail('E_INVALID_UTF16');
      } else if(c>=0xdc00 && c<=0xdfff) fail('E_INVALID_UTF16');
    }
    return text;
  } catch (e) {
    if (e?.code === 'E_INVALID_UTF16') throw e;
    fail('E_STRING');
  }
}
function int_value(token, negative) {
  if (!/^[0-9]+$/.test(token ?? '')) fail('E_TYPE');
  const n = BigInt(token) * (negative ? -1n : 1n);
  if (n < MIN || n > MAX) fail('E_INT_OVERFLOW');
  return n;
}
export function transpile_result_int_parse_tokens(toks) {
  // Fail-closed grammar: one checked parser function followed by one main,
  // or main directly matching the builtin Result. No general JS interpolation.
  if (toks.length > 4096) fail('E_TOKEN_LIMIT');
  let i=0;
  const peek=()=>toks[i];
  const eat=(token)=>peek()===token ? (i++,true) : false;
  const expect=(token)=>{if(!eat(token))fail('E_UNSUPPORTED_RESULT_SYNTAX');};
  const name=()=>id(toks[i++]);
  const parse_args=()=>{
    expect('(');
    const str=value(toks[i++]);
    expect(')');
    return str;
  };
  let functionName=null;
  if (peek()==='pub' && toks[i+1]==='fnc' && toks[i+2]!=='main') i++;
  if (peek()==='fnc' && toks[i+1]!=='main') {
    expect('fnc');
    functionName=name();
    expect('(');expect('string');
    const arg=name();
    expect(')');expect(':');
    expect('Result');expect('<');expect('int');expect(',');expect('Error');expect('>');
    expect('{');expect('val');
    const local=name();expect('=');
    expect('int');expect('.');expect('parse');expect('(');
    const passed=toks[i++];
    if(passed!==arg)
      fail(/^[0-9]+$/.test(passed??'') || (passed??'').startsWith('"') ? 'E_TYPE' : 'E_UNBOUND');
    expect(')');
    expect('?');expect(';');
    expect('return');expect('Ok');expect('(');expect(local);expect(')');
    expect(';');expect('}');
  }
  eat('pub');
  expect('fnc');expect('main');expect('(');expect(')');expect(':');
  expect('int');expect('{');expect('return');expect('match');
  // One typed subject evaluated exactly once; not an arbitrary expression.
  let direct=false;
  if (eat('int')) {
    direct=true;expect('.');expect('parse');
    if(functionName!==null)fail('E_UNSUPPORTED_RESULT_SYNTAX');
  } else {
    const callee=name();
    if(callee!==functionName)fail('E_UNBOUND');
  }
  const literal=parse_args();
  expect('over');
  const arms = {};
  for (let n=0; peek()==='on'; n++) {
    if(n>=3)fail('E_MATCH_DUPLICATE');
    expect('on');
    const tag=toks[i++];
    if (tag!=='Ok' && tag!=='Err') fail('E_MATCH');
    if(Object.hasOwn(arms,tag))fail('E_MATCH_DUPLICATE');
    expect('(');
    let bind=null;
    if(peek()!==')')bind=name();
    expect(')');
    expect('->');
    let expression=null;
    let negative=eat('-');
    if (/^[0-9]+$/.test(peek()??'')) expression=int_value(toks[i++],negative).toString()+'n';
    else {
      if(negative || tag!=='Ok' || !bind)fail('E_TYPE');
      const ident=name();
      if(ident!==bind || ident==='_')fail('E_UNBOUND');
      expression='subject.value';
    }
    arms[tag]=expression;
    eat(',');
  }
  if(!Object.hasOwn(arms,'Ok') || !Object.hasOwn(arms,'Err'))
    fail('E_MATCH_NONEXHAUSTIVE');
  expect('end');expect(';');expect('}');
  if(i!==toks.length)fail('E_TRAILING_SOURCE');
  const encoded=JSON.stringify(literal); // never splice raw Atto source into JS
  const generated=[
    '// Typed Result<int,Error> compiled Atto JS Worker subset.',
    'const MAX=9223372036854775807n,MIN=-9223372036854775808n;',
    'function int_parse(text){',
    ' const bytes=new TextEncoder().encode(text);',
    " const err=()=>Object.freeze({tag:1,error:Object.freeze(new Error('invalid integer'))});",
    ' if(bytes.length===0||bytes.length>1024)return err();',
    ' let at=0,negative=false;',
    " if(bytes[0]===45||bytes[0]===43){negative=bytes[0]===45;at=1;}",
    ' if(at===bytes.length)return err();',
    ' const limit=negative?MIN:-MAX,cutoff=limit/10n;',
    ' let n=0n;',
    ' for(;at<bytes.length;at++){',
    '  const byte=bytes[at]; if(byte<48||byte>57)return err();',
    '  const digit=BigInt(byte-48);',
    '  if(n<cutoff)return err();n*=10n;',
    '  if(n<limit+digit)return err();n-=digit;',
    ' }',
    ' return Object.freeze({tag:0,value:negative?n:-n});',
    '}',
    'export async function create_tenant({tenant,generation}){',
    ' let executed=false;',
    ' return {async on_message(){',
    "  if(executed)throw new Error('E_MAIN_ALREADY_CALLED');executed=true;",
    '  const parse_id=(text)=>{',
    '   const result=int_parse(text);',
    '   if(result.tag===1)return result; // ? preserves original Err',
    '   return Object.freeze({tag:0,value:result.value});',
    '  };',
    '  const subject='+(direct?'int_parse(':'parse_id(')+encoded+');',
    '  const result=subject.tag===0?('+arms.Ok+'):('+arms.Err+');',
    "  return {value:String(result),stdout:'',actors:0};",
    ' }};',
    '}',''
  ].join('\n');
  return {backend:'js',trusted:true,guest_abi:'atto.js.browser.result-int-parse.v1',module_source:generated};
}
