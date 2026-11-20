// Bounded source-to-ESM direct-invocation profile for typed void lambdas.
// This is deliberately *not* general closure support. The caller's lexer and
// source-admission checks must run before this parser is invoked.
const MAX_TOKENS = 256;
const MAX_PARAMS = 16;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(['void', 'int', 'string', 'return', 'fnc', 'const', 'pub', 'main']);
const MAX_I64 = (1n << 63n) - 1n;

export class VoidLambdaProfileError extends Error {
  constructor(message, token) {
    super('error: LAMBDA_VOID_PROFILE: ' + message +
      (token ? ' at ' + token.line + ':' + token.col : ''));
    this.name = 'VoidLambdaProfileError';
  }
}

export function compileVoidLambdaDirect(tokens) {
  const fail = (message, at) => { throw new VoidLambdaProfileError(message, at || tokens[i]); };
  if (!Array.isArray(tokens) || tokens.length > MAX_TOKENS || tokens.length < 20) {
    throw new VoidLambdaProfileError('source outside bounded direct-lambda profile');
  }
  let i = 0;
  const peek = () => tokens[i] || tokens[tokens.length - 1];
  const is = (s) => peek()?.value === s;
  const take = (s) => { if (is(s)) { i++; return true; } return false; };
  const expect = s => { if (!take(s)) fail('expected ' + s + ', found ' + String(peek()?.value)); };
  const identifier = () => {
    const t = peek();
    if (t.kind !== 'id' || !IDENT.test(t.value) || RESERVED.has(t.value))
      fail('expected nonreserved identifier', t);
    i++;
    return t.value;
  };
  const type = () => {
    const t = peek();
    if (take('int')) return 'int';
    if (take('string')) return 'string';
    fail('void lambda arguments must be int or string', t);
  };
  const integer = () => {
    const t = peek();
    if (t.kind !== 'int' || !/^[0-9]+(?:_[0-9]+)*$/.test(t.value))
      fail('expected int literal', t);
    i++;
    const n = BigInt(t.value.replaceAll('_', ''));
    if (n > MAX_I64) fail('int literal outside signed-i64 range', t);
    return n;
  };
  const string = () => {
    const t = peek();
    if (t.kind !== 'string' || !t.value || typeof t.value.raw !== 'string')
      fail('expected plain quoted string literal', t);
    // Narrow, literal-only subset: no escapes, templates, or host interpolation.
    // JSON.stringify below guarantees emitted code does not inherit source JS.
    if (!/^"[A-Za-z0-9 _.-]{0,128}"$/.test(t.value.raw))
      fail('unsupported string escape or non-ASCII literal', t);
    i++;
    return t.value.raw.slice(1, -1);
  };
  expect('pub');
  expect('fnc');
  expect('main');
  expect('(');
  expect(')');
  if (!take(':')) expect('->');
  expect('int');
  expect('{');
  expect('const');
  const name = identifier();
  expect('=');
  expect('|');
  const parameters = [];
  if (!is('|')) {
    do {
      if (parameters.length >= MAX_PARAMS) fail('parameter limit');
      let pname, ptype;
      if (tokens[i]?.kind === 'id' && tokens[i+1]?.value === ':') {
        pname = identifier();
        expect(':');
        ptype = type();
      } else {
        ptype = type();
        pname = identifier();
      }
      if (parameters.some(p => p.name === pname)) fail('duplicate lambda parameter ' + pname);
      parameters.push({name: pname, type: ptype});
    } while (take(','));
  }
  expect('|');
  if (take(':')) {
    expect('void');
    expect('->');
  } else {
    expect('->');
    take('void');
  }
  expect('{');
  expect('return');
  expect(';');
  const bodyClose = peek();
  expect('}');
  const hasSemicolon = take(';');
  if (!hasSemicolon && peek().line <= bodyClose.line)
    fail('lambda binding requires a semicolon or newline');
  const calledName = identifier();
  if (calledName !== name) fail('lambda must be directly invoked without escape');
  expect('(');
  const argumentsList = [];
  if (!is(')')) {
    do {
      if (argumentsList.length >= MAX_PARAMS) fail('argument limit');
      const wanted = parameters[argumentsList.length]?.type;
      if (!wanted) fail('argument arity mismatch');
      argumentsList.push(wanted === 'int' ? integer() : string());
    } while (take(','));
  }
  expect(')');
  expect(';');
  if (argumentsList.length !== parameters.length) fail('argument arity mismatch');
  expect('return');
  const result = integer();
  expect(';');
  expect('}');
  if (peek()?.kind !== 'eof') fail('unsupported statement or trailing tokens');

  const emitArg = (value, p) => p.type === 'int' ? `${value}n` : JSON.stringify(value);
  const checks = parameters.map((p, index) => p.type === 'int'
    ? `if(typeof _p${index}!=="bigint" || _p${index}<-(1n<<63n) || _p${index}>(1n<<63n)-1n)throw new TypeError("int argument outside signed i64");`
    : `if(typeof _p${index}!=="string")throw new TypeError("string argument required");`);
  return [
    '// Closed, direct-invocation typed void lambda profile. No captures or host privileges.',
    'export function main(){',
    `function _lambda(${parameters.map((_,j)=>'_p'+j).join(',')}){${checks.join('')}return;}`,
    `_lambda(${argumentsList.map((a,j)=>emitArg(a,parameters[j])).join(',')});`,
    `return ${result}n;`,
    '}',
    ''
  ].join('\n');
}
