// Bounded, capture-free, direct-call scalar const fnc -> ESM profile.
// Inputs MUST already be tokenized and screened by the main source frontend.
// This is not first-class closure storage, a runtime lambda ABI, or Wasm codegen.
const MAX_TOKENS = 128;
const MAX_PARAMS = 8;
const MAX_I64 = (1n << 63n) - 1n;
const MIN_I64 = -(1n << 63n);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(['fnc','const','val','let','pub','main','return','int','bool','void','true','false']);

export class IntConstLambdaError extends Error {
  constructor(code, reason, token) {
    super(`error: ${code}: ${reason}${token ? ` at ${token.line}:${token.col}` : ''}`);
    this.name = 'IntConstLambdaError';
    this.code = code;
  }
}

export function compileIntConstLambdaDirect(tokens) {
  if (!Array.isArray(tokens) || tokens.length < 17 || tokens.length > MAX_TOKENS)
    throw new IntConstLambdaError('E_UNSUPPORTED', 'bounded int const lambda source required');
  let i = 0;
  const peek = () => tokens[i] ?? tokens[tokens.length - 1];
  const has = value => peek()?.value === value;
  const take = value => { if (has(value)) { i++; return true; } return false; };
  const fail = (code, message, token = peek()) => { throw new IntConstLambdaError(code, message, token); };
  const expect = value => { if (!take(value)) fail('E_SYNTAX', `expected ${value}`); };
  const name = () => {
    const t = peek();
    if (t.kind !== 'id' || !IDENT.test(t.value) || RESERVED.has(t.value))
      fail('E_SYNTAX', 'invalid or reserved callable identifier');
    i++;
    return t.value;
  };
  const scalarType = () => {
    if (take('int')) return 'int';
    if (take('bool')) return 'bool';
    fail('E_TYPE', 'only int and bool parameter values supported');
  };
  const number = () => {
    const t = peek();
    const neg = take('-');
    const n = peek();
    if (n.kind !== 'int' || !/^[0-9]+(?:_[0-9]+)*$/.test(n.value))
      fail('E_TYPE', 'expected signed i64 literal', t);
    i++;
    const v = BigInt(n.value.replaceAll('_','')) * (neg ? -1n : 1n);
    if (v < MIN_I64 || v > MAX_I64) fail('E_TYPE', 'integer outside signed i64', n);
    return v;
  };
  const parseHead = () => {
    expect('const'); expect('fnc');
    const functionName = name();
    expect('='); expect('|');
    const params = [];
    if (!has('|')) {
      do {
        if (params.length >= MAX_PARAMS) fail('E_UNSUPPORTED', 'too many direct parameters');
        let n; let type = null;
        if (has('int') || has('bool')) {
          type = scalarType(); n = name();
        } else {
          n = name();
          if (take(':')) type = scalarType();
        }
        if (params.some(p => p.name === n)) fail('E_DUPLICATE', 'duplicate lambda parameter');
        params.push({name:n,type});
      } while (take(','));
    }
    expect('|'); expect(':'); expect('int'); expect('->');
    // Body is a single signed literal or an int parameter optionally plus a
    // signed literal. No external reads, member access, arbitrary statements.
    let body;
    if (has('-') || peek().kind === 'int') {
      body = {kind:'literal',value:number()};
    } else if (peek().kind === 'id') {
      const identifier = name();
      const index = params.findIndex(p => p.name === identifier);
      if (index < 0) fail('E_CONST', 'closed const fnc cannot capture external names');
      if (params[index].type === 'bool') fail('E_TYPE', 'bool value cannot be returned as int');
      body = {kind:'param',index,offset:take('+') ? number() : 0n};
    } else fail('E_SYNTAX', 'only a bounded scalar lambda body is lowered');
    expect(';');
    return {functionName,params,body};
  };
  const parseMainHeader = () => {
    expect('pub'); expect('fnc'); expect('main'); expect('('); expect(')');
    if (!take(':')) expect('->');
    expect('int'); expect('{');
  };
  const moduleScope = has('const');
  let binding;
  if (moduleScope) {
    binding = parseHead();
    // Module callable ABI is committed prior to visiting any call site.
    if (binding.params.some(p => p.type === null))
      fail('E_INFER', 'module-scope const fnc requires typed parameters');
    parseMainHeader();
  } else {
    parseMainHeader();
    if (has('val') || has('let')) fail('E_CONST', 'runtime captures unsupported in closed const fnc profile');
    binding = parseHead();
  }
  expect('return');
  if (name() !== binding.functionName) fail('E_CONST', 'only direct calls to the closed const binding are supported');
  expect('(');
  const args = [];
  if (!has(')')) {
    do {
      if (args.length >= binding.params.length) fail('E_ARITY', 'too many lambda arguments');
      const token = peek();
      let value; let type;
      if (take('true')) { value = true; type = 'bool'; }
      else if (take('false')) { value = false; type = 'bool'; }
      else if (has('-') || token.kind === 'int') { value = number(); type = 'int'; }
      else fail('E_TYPE', 'direct lambda arguments must be scalar literals');
      const p = binding.params[args.length];
      if (p.type !== null && p.type !== type) fail('E_TYPE', 'lambda argument type mismatch', token);
      if (p.type === null) p.type = type;
      args.push({type,value});
    } while (take(','));
  }
  expect(')'); expect(';'); expect('}');
  if (peek()?.kind !== 'eof') fail('E_SYNTAX', 'trailing source not admitted');
  if (args.length !== binding.params.length) fail('E_ARITY', 'missing lambda arguments');
  if (binding.body.kind === 'param' && binding.params[binding.body.index].type !== 'int')
    fail('E_TYPE', 'lambda result requires int input');
  // Emit only compiler-generated identifiers and source-checked scalar
  // literals. The code includes no source-spliced executable identifier.
  const paramNames = binding.params.map((_,k) => `_p${k}`);
  const checks = binding.params.map((p,k) => p.type === 'int'
    ? `if(typeof _p${k}!=="bigint"||_p${k}<-(1n<<63n)||_p${k}>(1n<<63n)-1n)throw new TypeError("E_TYPE: int argument");`
    : `if(typeof _p${k}!=="boolean")throw new TypeError("E_TYPE: bool argument");`);
  const expr = binding.body.kind === 'literal'
    ? `${binding.body.value}n`
    : `_p${binding.body.index}+(${binding.body.offset}n)`;
  const checkedReturn = `const _result=${expr};if(_result<-(1n<<63n)||_result>(1n<<63n)-1n)throw new RangeError("E_OVERFLOW: checked signed i64");return _result;`;
  const argText = args.map(arg => arg.type === 'int' ? `${arg.value}n` : String(arg.value)).join(',');
  return [
    '// Checked, nonescaping scalar const fnc. No closure environment or host imports.',
    'export function main(){',
    `function _lambda(${paramNames.join(',')}){${checks.join('')}${checkedReturn}}`,
    `return _lambda(${argText});`,
    '}',
    ''
  ].join('\n');
}
