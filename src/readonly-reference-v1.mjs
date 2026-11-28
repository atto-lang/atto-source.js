import {tokenizeCountedProfileSource} from './program-v2.mjs';

// Isolated closed source profile. The ordinary program-v2 IR API is not
// changed and does not claim to understand ownership or object lifetimes.
const marker='// atto-ownership: borrow-default-v1';
const fail=()=>{throw new Error('E_NATIVE_READONLY: unsupported closed class reference profile');};
const reserved=new Set('define class as end pub let int fnc main return new mut const val self actor unsafe suspends await import void bool float string true false null if else while for match defer recover borrow take copy move ref deref unref task spawn send critical static private constructor namespace module using with set Option Result Array Map List RawPointer Storage prototype __proto__'.split(' '));
const max=(1n<<63n)-1n;
function parse(source){
  if(typeof source!=='string'||source.length>65536||source.split(/\r?\n/,1)[0]!==marker)fail();
  // Identical narrow ASCII grammar across Forge/JS. The shared production
  // lexer still authenticates source characters and reserved syntax.
  if(/[^\x09-\x0d\x20-\x7e]/.test(source))fail();
  const tokens=tokenizeCountedProfileSource(source);
  if(tokens.length>1024)fail();
  let at=0;
  const peek=()=>tokens[at]?.value;
  const take=(v,k)=>{const t=tokens[at++];if(!t||t.value!==v||t.kind!==k)fail();};
  const word=v=>take(v,'id'), sym=v=>take(v,'sym');
  function name(){
    const t=tokens[at++];if(!t||t.kind!=='id'||t.lexeme||t.spelling||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(t.value)||reserved.has(t.value))fail();
    return t.value;
  }
  function literal(){
    const t=tokens[at++];if(!t||t.kind!=='int'||!/^[0-9]{1,19}$/.test(t.value))fail();
    const n=BigInt(t.value);if(n>max)fail();return n;
  }
  word('define');word('class');const cls=name();word('as');
  const fields=[],helpers=[],calls=[],ops=[];
  while(peek()==='pub'){
    if(fields.length>=8)fail();
    word('pub');word('let');word('int');const id=name();
    if(fields.some(f=>f.id===id))fail();
    sym('=');const value=literal();sym(';');fields.push({id,value});
  }
  if(!fields.length)fail();word('end');
  function call(owner){
    const id=name(),index=helpers.findIndex(h=>h.id===id);if(index<0)fail();
    sym('(');word(owner);sym(')');return index;
  }
  while(peek()==='fnc'){
    if(helpers.length>=8)fail();
    word('fnc');const id=name();if(id===cls||helpers.some(h=>h.id===id))fail();
    sym('(');word(cls);const p=name();sym(')');sym(':');word('int');sym('{');word('return');
    let plan;
    if(peek()===p){
      word(p);sym('.');const field=name(),index=fields.findIndex(f=>f.id===field);if(index<0)fail();
      plan={id,field:index};
    }else plan={id,forward:call(p)};
    sym(';');sym('}');helpers.push(plan);
  }
  if(!helpers.length)fail();
  word('pub');word('fnc');word('main');sym('(');sym(')');sym(':');word('int');sym('{');
  word('let');const owner=name();sym('=');word('new');word(cls);sym('(');sym(')');sym(';');
  word('return');calls.push(call(owner));
  while(peek()==='+'||peek()==='-'){
    if(calls.length>=8)fail();
    const op=peek();sym(op);ops.push(op);calls.push(call(owner));
  }
  sym(';');sym('}');take('<eof>','eof');if(at!==tokens.length)fail();
  return {fields,helpers,calls,ops};
}

export function compileReadonlyReferenceV1(source){
  const {fields,helpers,calls,ops}=parse(source);
  // No input identifier is interpolated into JavaScript. All names and
  // properties derive from bounded numeric positions in the admitted plan.
  const out=['// atto.closed-readonly-reference-v1',
    'const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;',
    'function checked(v){if(v<MIN||v>MAX)throw new RangeError("i64 arithmetic overflow");return v;}'];
  for(let i=0;i<helpers.length;i++){
    const h=helpers[i];
    out.push('function f'+i+'(p){return '+('field'in h?'p.f'+h.field:'f'+h.forward+'(p)')+';}');
  }
  out.push('export function main(){');
  out.push('const p={'+fields.map((f,i)=>'f'+i+':'+f.value+'n').join(',')+'};');
  out.push('let r=f'+calls[0]+'(p);');
  for(let i=1;i<calls.length;i++)out.push('r=checked(r'+ops[i-1]+'f'+calls[i]+'(p));');
  out.push('return r;}');
  return out.join('\n')+'\n';
}
