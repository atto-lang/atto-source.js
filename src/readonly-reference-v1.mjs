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
  const fields=[],helpers=[];
  while(peek()==='pub'){
    if(fields.length>=8)fail();
    word('pub');word('let');word('int');const id=name();
    if(fields.some(f=>f.id===id))fail();
    sym('=');const value=literal();sym(';');fields.push({id,value});
  }
  if(!fields.length)fail();word('end');
  let budget=512;
  function charge(depth){if(depth>16||--budget<0)fail();}
  function slot(names,id,kind){
    const i=names.findIndex(n=>n.id===id&&n.kind===kind);
    if(i<0)fail();return i;
  }
  function expr(names,depth=0){
    charge(depth);
    let left=atom(names,depth+1),terms=1;
    while(peek()==='+'||peek()==='-'){
      if(terms++>=8)fail();charge(depth);
      const op=peek();sym(op);left={op,left,right:atom(names,depth+1)};
    }
    return left;
  }
  function atom(names,depth){
    charge(depth);
    if(tokens[at]?.kind==='int')return {literal:literal()};
    if(peek()==='('){sym('(');const e=expr(names,depth+1);sym(')');return e;}
    const id=name();
    if(peek()==='.'){
      const owner=slot(names,id,'ref');sym('.');
      const field=name(),index=fields.findIndex(f=>f.id===field);if(index<0)fail();
      return {field:index,owner};
    }
    if(peek()==='('){
      if(names.some(n=>n.id===id))fail();
      const target=helpers.findIndex(h=>h.id===id);if(target<0)fail();
      sym('(');
      const args=helpers[target].params.map((kind,i)=>{
        if(i)sym(',');
        return kind==='ref'?{local:slot(names,name(),'ref')}:expr(names,depth+1);
      });
      sym(')');return {target,args};
    }
    return {local:slot(names,id,'int')};
  }
  function body(names){
    const locals=[];
    while(peek()==='val'){
      if(locals.length>=8)fail();
      word('val');word('int');const id=name();
      if(names.some(n=>n.id===id)||helpers.some(h=>h.id===id))fail();
      sym('=');locals.push(expr(names));sym(';');names.push({id,kind:'int'});
    }
    word('return');const result=expr(names);sym(';');sym('}');
    return {locals,result};
  }
  while(peek()==='fnc'){
    if(helpers.length>=8)fail();
    word('fnc');const id=name();if(id===cls||helpers.some(h=>h.id===id))fail();
    sym('(');const names=[];
    for(;;){
      if(names.length>=8)fail();
      const kind=peek()==='int'?'int':'ref';word(kind==='int'?'int':cls);
      const n=name();
      if(n===id||names.some(x=>x.id===n)||helpers.some(h=>h.id===n))fail();
      names.push({id:n,kind});if(peek()!==',')break;sym(',');
    }
    if(!names.some(n=>n.kind==='ref'))fail();
    sym(')');sym(':');word('int');sym('{');
    const params=names.map(n=>n.kind);
    helpers.push({id,params,body:body(names)});
  }
  if(!helpers.length)fail();
  word('pub');word('fnc');word('main');sym('(');sym(')');sym(':');word('int');sym('{');
  word('let');const owner=name();if(helpers.some(h=>h.id===owner))fail();
  sym('=');word('new');word(cls);sym('(');sym(')');sym(';');
  const root=body([{id:owner,kind:'ref'}]);
  take('<eof>','eof');if(at!==tokens.length)fail();
  return {fields,helpers,root};
}

export function compileReadonlyReferenceV1(source){
  const {fields,helpers,root}=parse(source);
  const out=['// atto.closed-readonly-reference-v1',
    'const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;',
    'function checked(v){if(v<MIN||v>MAX)throw new RangeError("i64 arithmetic overflow");return v;}'];
  const variable=i=>i===0?'p':'v'+i;
  function render(e){
    if('literal'in e)return e.literal+'n';
    if('local'in e)return variable(e.local);
    if('field'in e)return variable(e.owner)+'.f'+e.field;
    if('target'in e)return 'f'+e.target+'('+e.args.map(render).join(',')+')';
    return 'checked('+render(e.left)+e.op+render(e.right)+')';
  }
  function renderBody(b,n){
    for(let i=0;i<b.locals.length;i++)out.push('const '+variable(n+i)+'='+render(b.locals[i])+';');
    out.push('return '+render(b.result)+';}');
  }
  for(let i=0;i<helpers.length;i++){
    const h=helpers[i];
    out.push('function f'+i+'('+h.params.map((_,i)=>variable(i)).join(',')+'){');
    renderBody(h.body,h.params.length);
  }
  out.push('export function main(){');
  out.push('const p={'+fields.map((f,i)=>'f'+i+':'+f.value+'n').join(',')+'};');
  renderBody(root,1);
  return out.join('\n')+'\n';
}
