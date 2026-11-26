// Restricted source-to-ESM unsigned scalar profile. No fallback to signed IR.
const MAX = (1n << 64n) - 1n;
const types = new Set(['u64', 'uint']);
const words = /^[A-Za-z_][A-Za-z0-9_]*$/;
const reserved = new Set(['pub', 'fnc', 'return', 'u64', 'uint']);
function fail(message) { throw new SyntaxError('E_U64_PROFILE: ' + message); }

export function compileCheckedU64ScalarV1(source) {
  if (typeof source !== 'string' || source.length > 16384) fail('source budget');
  // This explicit profile admits only ASCII identifiers, decimal literals and
  // listed punctuation; no comments, strings, imports or effects.
  const token = /[ \t\r\n]+|[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[(){}:,;+*\-]/y;
  const ts = [];
  for (let i = 0; i < source.length;) {
    token.lastIndex = i;
    const m = token.exec(source);
    if (!m) fail('unsupported source at ' + i);
    i = token.lastIndex;
    if (!/^[ \t\r\n]/.test(m[0])) ts.push(m[0]);
    if (ts.length > 4096) fail('token budget');
  }
  let at = 0, nodes = 0;
  const peek = () => ts[at];
  const take = value => { if (peek() !== value) fail('expected ' + value); at++; };
  function name() {
    const v = ts[at++];
    if (typeof v !== 'string' || v.length > 64 || !words.test(v) || reserved.has(v)) fail('identifier');
    return v;
  }
  function type() { if (!types.has(ts[at++])) fail('unsigned type required'); }
  function expr(depth = 0, min = 0) {
    if (++nodes > 2048 || depth > 32) fail('expression budget');
    let a;
    if (peek() === '(') { take('('); a = expr(depth + 1); take(')'); }
    else if (/^(0|[1-9][0-9]*)$/.test(peek() ?? '')) {
      const raw = ts[at++];
      if (raw.length > 20 || BigInt(raw) > MAX) fail('literal outside u64');
      a = {kind:'literal', value:raw};
    } else {
      const id = name();
      if (peek() === '(') {
        take('('); const args = [];
        if (peek() !== ')') {
          do {
            if (args.length === 16) fail('arity budget');
            args.push(expr(depth + 1));
            if (peek() !== ',') break;
            take(',');
          } while (true);
        }
        take(')'); a = {kind:'call', id, args};
      } else a = {kind:'param', id};
    }
    for (;;) {
      const op = peek();
      const prec = op === '*' ? 2 : op === '+' || op === '-' ? 1 : 0;
      if (prec === 0 || prec < min) break;
      at++;
      if (++nodes > 2048) fail('expression budget');
      a = {kind:'binary', op, left:a, right:expr(depth + 1, prec + 1)};
    }
    return a;
  }
  const funcs = new Map();
  while (at < ts.length) {
    if (funcs.size === 32) fail('function budget');
    const pub = peek() === 'pub'; if (pub) take('pub');
    take('fnc'); const id = name();
    if (funcs.has(id)) fail('duplicate function');
    take('('); const params = [];
    if (peek() !== ')') {
      do {
        if (params.length === 16) fail('arity budget');
        type(); const p = name();
        if (params.includes(p)) fail('duplicate parameter');
        params.push(p);
        if (peek() !== ',') break;
        take(',');
      } while (true);
    }
    take(')'); take(':'); type(); take('{'); take('return');
    const body = expr(); take(';'); take('}');
    funcs.set(id, {id, pub, params, body, index:funcs.size});
  }
  const main = funcs.get('main');
  if (!main?.pub || main.params.length !== 0) fail('public zero-arity main required');
  // Resolve names/arity and reject cycles before any ESM is returned. Bound
  // expanded call work as well as the source and expression-tree depth.
  const active = new Set(), costs = new Map();
  function cost(fn) {
    if (active.has(fn.id)) fail('recursive call graph');
    if (costs.has(fn.id)) return costs.get(fn.id);
    active.add(fn.id);
    function visit(n, d) {
      if (d > 64) fail('expression tree depth');
      let c = 1;
      if (n.kind === 'param' && !fn.params.includes(n.id)) fail('unknown parameter');
      if (n.kind === 'binary') c += visit(n.left,d+1) + visit(n.right,d+1);
      if (n.kind === 'call') {
        const target = funcs.get(n.id);
        if (!target || target.params.length !== n.args.length) fail('unknown function or wrong arity');
        for (const arg of n.args) c += visit(arg,d+1);
        c += cost(target);
      }
      if (c > 10000) fail('expanded work budget');
      return c;
    }
    const c = visit(fn.body, 0);
    active.delete(fn.id); costs.set(fn.id,c); return c;
  }
  for (const fn of funcs.values()) cost(fn);
  function emit(n, fn) {
    if (n.kind === 'literal') return n.value + 'n';
    if (n.kind === 'param') return 'p' + fn.params.indexOf(n.id);
    if (n.kind === 'call') return 'f' + funcs.get(n.id).index + '(' + n.args.map(a=>emit(a,fn)).join(',') + ')';
    const helper = n.op === '+' ? 'add' : n.op === '-' ? 'sub' : 'mul';
    return helper + '(' + emit(n.left,fn) + ',' + emit(n.right,fn) + ')';
  }
  const out = [
    'const MAX=(1n<<64n)-1n;',
    'function check(v){if(typeof v!=="bigint")throw new TypeError("u64 BigInt required");if(v<0n||v>MAX){const e=new RangeError("E_U64_OVERFLOW");e.code="integer_overflow";throw e;}return v;}',
    'function add(a,b){return check(a+b);}',
    'function sub(a,b){return check(a-b);}',
    'function mul(a,b){return check(a*b);}'
  ];
  for (const fn of funcs.values()) {
    const params = fn.params.map((_,i)=>'p'+i);
    out.push('function f'+fn.index+'('+params.join(',')+'){'+params.map(p=>'check('+p+');').join('')+'return check('+emit(fn.body,fn)+');}');
  }
  // The bounded guest ABI exposes only main; no host value injection or
  // namespace-dependent JS identifier interpolation is needed.
  out.push('export {f'+main.index+' as main};');
  return out.join('\n')+'\n';
}
