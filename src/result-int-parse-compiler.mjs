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
  let functionName=null, directFunctionReturn=false;
  if (peek()==='pub' && toks[i+1]==='fnc' && toks[i+2]!=='main') i++;
  if (peek()==='fnc' && toks[i+1]!=='main') {
    expect('fnc');
    functionName=name();
    expect('(');expect('string');
    const arg=name();
    expect(')');expect(':');
    expect('Result');expect('<');expect('int');expect(',');expect('Error');expect('>');
    expect('{');
    let local=null;
    if(eat('return')) {
      // Preserve typed Results, no new Ok wrapper, no ? returning an int.
      directFunctionReturn=true;
    } else {
      expect('val');
      local=name();
      if(eat(':'))expect('int');
      expect('=');
    }
    expect('int');expect('.');expect('parse');expect('(');
    const passed=toks[i++];
    if(passed!==arg)
      fail(/^[0-9]+$/.test(passed??'') || (passed??'').startsWith('"') ? 'E_TYPE' : 'E_UNBOUND');
    expect(')');
    if(directFunctionReturn) {
      expect(';');expect('}');
    } else {
      expect('?');expect(';');
      expect('return');expect('Ok');expect('(');expect(local);expect(')');
      expect(';');expect('}');
    }
  }
  eat('pub');
  expect('fnc');expect('main');expect('(');expect(')');expect(':');
  expect('int');expect('{');
  const returnMatch=eat('return');
  expect('match');
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
    // Nominal constructor alias only: "on is Ok<value>" is exactly the
    // same ADT tag as "on Ok(value)". Angle brackets bind a payload;
    // they are NOT generic type tests or arbitrary guest extractors.
    const isNominal=eat('is');
    const tag=toks[i++];
    if(tag!=='Ok' && tag!=='Err') {
      if(isNominal && (tag==='None'||tag==='Some'))fail('E_TYPE');
      fail(isNominal?'E_PATTERN':'E_MATCH');
    }
    if(Object.hasOwn(arms,tag))fail('E_MATCH_DUPLICATE');
    let bind=null;
    if(isNominal) {
      if(!eat('<'))fail('E_ARITY'); // Result<int,Error> Ok/Err have a payload.
      if(peek()==='>' || peek()==='(' || peek()==='<' ||
         peek()===',' || peek()==='None' || peek()==='Some')fail('E_UNSUPPORTED_RESULT_SYNTAX');
      bind=name();
      if(peek()!=='>')fail('E_UNSUPPORTED_RESULT_SYNTAX');
      expect('>');
    } else {
      expect('(');
      if(peek()!==')')bind=name();
      expect(')');
    }
    if(tag==='Ok' && bind===null)fail('E_ARITY');
    expect('->');
    let expression;
    if(!returnMatch) {
      // Checked, total statement match profile: a return in every arm,
      // or a single i64 equality guard with two explicit returns.
      expect('{');
      if(eat('if')) {
        if(tag!=='Ok' || !bind || bind==='_')fail('E_TYPE');
        const lhs=name();
        if(lhs!==bind)fail('E_UNBOUND');
        expect('eq');
        const minusGuard=eat('-');
        const cmp=int_value(toks[i++],minusGuard).toString()+'n';
        expect('then');expect('return');
        const minusYes=eat('-');
        const yes=int_value(toks[i++],minusYes).toString()+'n';
        expect(';');expect('else');expect('return');
        const minusNo=eat('-');
        const no=int_value(toks[i++],minusNo).toString()+'n';
        expect(';');expect('fi');
        expression='(subject.value==='+cmp+'?'+yes+':'+no+')';
      } else {
        expect('return');
        const minus=eat('-');
        expression=int_value(toks[i++],minus).toString()+'n';
        expect(';');
      }
      expect('}');
    } else {
      const negative=eat('-');
      if(/^[0-9]+$/.test(peek()??'')) expression=int_value(toks[i++],negative).toString()+'n';
      else {
        if(negative || tag!=='Ok' || !bind)fail('E_TYPE');
        const ident=name();
        if(ident!==bind || ident==='_')fail('E_UNBOUND');
        expression='subject.value';
      }
    }
    arms[tag]=expression;
    eat(',');
  }
  if(!Object.hasOwn(arms,'Ok') || !Object.hasOwn(arms,'Err'))
    fail('E_MATCH_NONEXHAUSTIVE');
  expect('end');
  if(returnMatch)expect(';');
  else eat(';');
  expect('}');
  if(i!==toks.length)fail('E_TRAILING_SOURCE');
  const encoded=JSON.stringify(literal); // never splice raw Atto source into JS
  const generated=[
    '// Typed Result<int,Error> compiled Atto JS Worker subset.',
    'const MAX=9223372036854775807n,MIN=-9223372036854775808n;',
    // A guest Error is nominal and reference-identical but must never capture
    // a host JavaScript stack or inherit mutable cross-tenant prototype state.
    'class AttoError { constructor(message) { this.message=message; Object.freeze(this); } }',
    'Object.freeze(AttoError.prototype); Object.freeze(AttoError);',
    'function int_parse(text){',
    ' const bytes=new TextEncoder().encode(text);',
    " const err=()=>Object.freeze({tag:1,error:new AttoError('invalid integer')});",
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
    'export async function create_tenant({tenant,generation}={}){',
    // This validates the trusted Worker adapter contract, not host
    // authorization. Real TenantVM admission must still bind identity,
    // capability ceiling, epoch, and revocation at its host boundary.
    ' if(typeof tenant!=="string"||tenant.length===0||tenant.length>128||tenant.trim()!==tenant||',
    '    !Number.isSafeInteger(generation)||generation<1||generation>2147483647)',
    "  throw new Error('E_TENANT_BINDING');",
    ' let executed=false;',
    ' return Object.freeze({async on_message(){',
    "  if(executed)throw new Error('E_MAIN_ALREADY_CALLED');executed=true;",
    '  const parse_id=(text)=>{',
    '   const result=int_parse(text);',
    '   if(result.tag===1)return result; // ? preserves original Err',
    directFunctionReturn
      ? '   return result; // same original Ok/Err handle'
      : '   return Object.freeze({tag:0,value:result.value});',
    '  };',
    '  const subject='+(direct?'int_parse(':'parse_id(')+encoded+');',
    '  const result=subject.tag===0?('+arms.Ok+'):('+arms.Err+');',
    "  return {value:String(result),stdout:'',actors:0};",
    ' }});',
    '}',''
  ].join('\n');
  return {backend:'js',trusted:true,guest_abi:'atto.js.browser.result-int-parse.v1',module_source:generated};
}
