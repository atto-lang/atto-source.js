// Restricted source-to-ESM unsigned scalar profile. No fallback to signed IR.
const MAX = (1n << 64n) - 1n;
const types = new Set(['u64', 'uint']);
const words = /^[A-Za-z_][A-Za-z0-9_]*$/;
const reserved = new Set(['pub', 'fnc', 'return', 'u64', 'uint']);
function fail(message) { throw new SyntaxError('E_U64_PROFILE: ' + message); }

export function compileToCheckedU64IRV1(source) {
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
  function lower(n, fn, depth=0) {
    if (depth > 64) fail('expression tree depth');
    if (n.kind === 'literal') return {kind:'u64',value:n.value};
    if (n.kind === 'param') return {kind:'param',index:fn.params.indexOf(n.id)};
    if (n.kind === 'call') return {kind:'call',target:funcs.get(n.id)?.index ?? -1,args:n.args.map(a=>lower(a,fn,depth+1))};
    return {kind:'u64Binary',op:n.op,left:lower(n.left,fn,depth+1),right:lower(n.right,fn,depth+1)};
  }
  return validateCheckedU64IRV1({schemaVersion:2,dialect:'oreslang.program',integerModel:CHECKED_U64_IR_MODEL,
    sourceNamespace:null,modules:[],functions:[...funcs.values()].map(fn=>({module:null,name:fn.id,kind:'fnc',pub:fn.pub,
      params:fn.params,paramTypes:fn.params.map(()=> 'u64'),returnType:'u64',body:lower(fn.body,fn)}))});
}

// Explicit closed profile, not a general program-v2 extension. Direct IR inputs
// are plain data, not a sandbox for executable JS objects or Proxies.
export const CHECKED_U64_IR_MODEL='unsigned-u64-checked-v1';
function record(v, keys) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![null,Object.prototype].includes(Object.getPrototypeOf(v))) fail('IR record');
  if (Reflect.ownKeys(v).length !== keys.length) fail('IR fields');
  const copy={};
  for (const key of keys) {
    const d=Object.getOwnPropertyDescriptor(v,key);
    if (!d || !Object.hasOwn(d,'value')) fail('IR own data field');
    copy[key]=d.value;
  }
  return copy;
}
function array(v,max) {
  if (!Array.isArray(v) || Object.getPrototypeOf(v)!==Array.prototype || v.length>max || Reflect.ownKeys(v).length!==v.length+1) fail('IR array');
  const out=[];
  for(let i=0;i<v.length;i++) {
    const d=Object.getOwnPropertyDescriptor(v,String(i));
    if(!d||!Object.hasOwn(d,'value')) fail('IR array item');
    out.push(d.value);
  }
  return out;
}
function id(v) {
  if(typeof v!=='string'||v.length>64||!words.test(v)||reserved.has(v))fail('IR identifier');
  return v;
}
function index(v,n) { return Number.isSafeInteger(v)&&!Object.is(v,-0)&&v>=0&&v<n; }
export function validateCheckedU64IRV1(input) {
  const p=record(input,['schemaVersion','dialect','integerModel','sourceNamespace','modules','functions']);
  if(p.schemaVersion!==2||p.dialect!=='oreslang.program'||p.integerModel!==CHECKED_U64_IR_MODEL||p.sourceNamespace!==null||array(p.modules,0).length) fail('IR model');
  const names=new Set(), functions=array(p.functions,32).map(raw=>{
    const f=record(raw,['module','name','kind','pub','params','paramTypes','returnType','body']);
    const name=id(f.name),params=array(f.params,16).map(id),paramTypes=array(f.paramTypes,16);
    if(f.module!==null||f.kind!=='fnc'||typeof f.pub!=='boolean'||f.returnType!=='u64'||paramTypes.length!==params.length||paramTypes.some(t=>t!=='u64'))fail('IR function type');
    if(names.has(name)||new Set(params).size!==params.length)fail('IR duplicate name');
    names.add(name);return {...f,name,params,paramTypes};
  });
  const main=functions.find(f=>f.name==='main');
  if(!main?.pub||main.params.length!==0)fail('public zero-arity main required');
  const active=new Set(),costs=new Map();let nodes=0;
  function visit(raw,owner,depth) {
    if(++nodes>2048||depth>64)fail('expression tree depth or node budget');
    const kind=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptor(raw,'kind')?.value:undefined;
    if(kind==='u64') {
      const n=record(raw,['kind','value']);
      if(typeof n.value!=='string'||n.value.length>20||!/^(0|[1-9][0-9]*)$/.test(n.value)||BigInt(n.value)>MAX)fail('literal outside u64');
      return [n,1];
    }
    if(kind==='param') {
      const n=record(raw,['kind','index']);
      if(!index(n.index,functions[owner].params.length))fail('unknown parameter');return [n,1];
    }
    if(kind==='call') {
      const n=record(raw,['kind','target','args']);
      if(!index(n.target,functions.length))fail('unknown function or wrong arity');
      const args=array(n.args,16);
      if(args.length!==functions[n.target].params.length)fail('unknown function or wrong arity');
      let c=1;const normalized=args.map(a=>{const [v,w]=visit(a,owner,depth+1);c+=w;return v;});
      c+=cost(n.target);if(c>10000)fail('expanded work budget');return [{...n,args:normalized},c];
    }
    if(kind==='u64Binary') {
      const n=record(raw,['kind','op','left','right']);
      if(!['+','-','*'].includes(n.op))fail('IR operator');
      const [left,l]=visit(n.left,owner,depth+1),[right,r]=visit(n.right,owner,depth+1);
      if(1+l+r>10000)fail('expanded work budget');return [{...n,left,right},1+l+r];
    }
    fail('IR expression kind');
  }
  function cost(i) {
    if(active.has(i))fail('recursive call graph');
    if(costs.has(i))return costs.get(i);
    active.add(i);const [body,c]=visit(functions[i].body,i,0);functions[i].body=body;
    active.delete(i);costs.set(i,c);return c;
  }
  functions.forEach((_,i)=>cost(i));
  return {...p,modules:[],functions};
}
export function compileCheckedU64IRV1(input) {
  const {functions}=validateCheckedU64IRV1(input);
  function emit(n) {
    if (n.kind === 'u64') return n.value + 'n';
    if (n.kind === 'param') return 'p' + n.index;
    if (n.kind === 'call') return 'f' + n.target + '(' + n.args.map(emit).join(',') + ')';
    const helper = n.op === '+' ? 'add' : n.op === '-' ? 'sub' : 'mul';
    return helper + '(' + emit(n.left) + ',' + emit(n.right) + ')';
  }
  const out = [
    'const MAX=(1n<<64n)-1n;',
    'function check(v){if(typeof v!=="bigint")throw new TypeError("u64 BigInt required");if(v<0n||v>MAX){const e=new RangeError("E_U64_OVERFLOW");e.code="integer_overflow";throw e;}return v;}',
    'function add(a,b){return check(a+b);}',
    'function sub(a,b){return check(a-b);}',
    'function mul(a,b){return check(a*b);}'
  ];
  functions.forEach((fn,i)=>{
    const params = fn.params.map((_,j)=>'p'+j);
    out.push('function f'+i+'('+params.join(',')+'){'+params.map(p=>'check('+p+');').join('')+'return check('+emit(fn.body)+');}');
  });
  out.push('export {f'+functions.findIndex(f=>f.name==='main')+' as main};');
  return out.join('\n')+'\n';
}
export function compileCheckedU64ScalarV1(source) {
  return compileCheckedU64IRV1(compileToCheckedU64IRV1(source));
}
