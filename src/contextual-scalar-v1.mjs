// Closed scalar contextual specialization -> existing typed program-v2 IR.
// No runtime evaluator, capability capture, nominal instance or reflection.
const PREFIX='_atto_context_esm_';
export function lowerContextualScalar(tokens,fail,reserved,protectedName,maxTokens) {
  const v=(i)=>tokens[i]?.value;
  if(!tokens.some((t,i)=>t.kind==='id'&&t.value==='fnc'&&tokens[i+1]?.kind==='id'&&v(i+2)==='::'&&v(i+3)==='('))return tokens;
  const deny=(m,t=tokens[0])=>fail(m,t,'E_CONTEXT_PROFILE');
  if(tokens.some(t=>!['id','sym','int','eof'].includes(t.kind)))deny('non-scalar token in contextual profile');
  const id=(t)=>t?.kind==='id';
  const safe=(t)=>id(t)&&!reserved.has(t.value)&&!protectedName(t.value)&&!t.value.startsWith(PREFIX);
  const sym=(value,t)=>({kind:'sym',value,line:t.line,col:t.col});
  const ident=(value,t)=>({...sym(value,t),kind:'id'});
  if(tokens.some(t=>id(t)&&t.value.startsWith(PREFIX)))deny('reserved contextual name');
  const exact=(i,words)=>words.every((w,j)=>v(i+j)===w);
  const pair=(i)=>{
    if(v(i)!=='(')deny('expected contextual opening parenthesis',tokens[i]);
    let depth=0;
    for(let j=i;j<tokens.length;j++){
      if(v(j)==='(')depth++;
      else if(v(j)===')'&&--depth===0)return j;
      else if(['[',']','{','}',';'].includes(v(j)))deny('invalid contextual delimiter',tokens[j]);
    }
    deny('unclosed contextual parenthesis',tokens[i]);
  };
  const split=(part,empty=false)=>{
    if(!part.length){if(empty)return [];deny('empty context');}
    let depth=0,start=0;const out=[];
    for(let i=0;i<part.length;i++){
      const t=part[i];
      if(t.value==='(')depth++;
      else if(t.value===')'){if(--depth<0)deny('unmatched closing delimiter',t);}
      else if(['[',']','{','}',';'].includes(t.value))deny('invalid scalar delimiter',t);
      else if(t.value===','&&!depth){if(i===start)deny('empty argument',t);out.push(part.slice(start,i));start=i+1;}
    }
    if(depth||start===part.length)deny('unclosed or empty argument',part[0]);
    out.push(part.slice(start));return out;
  };
  if(!exact(0,['define','class'])||!safe(tokens[2])||!exact(3,['as','pub','static','fnc'])||!safe(tokens[7])||v(8)!=='::')deny('closed source-local contextual class required');
  const owner=v(2), member=v(7);
  if(owner===member||member==='make')deny('invalid contextual member');
  const ce=pair(9),pa=ce+1,pe=pair(pa);
  const params=(a,b,empty)=>split(tokens.slice(a+1,b),empty).map(p=>{
    if(p.length!==2||!['int','bool'].includes(p[0].value)||!safe(p[1])||p[1].value===owner)deny('typed scalar parameter required',p[0]);
    return {type:p[0],name:p[1]};
  });
  const context=params(9,ce,false),ordinary=params(pa,pe,true),all=[...context,...ordinary];
  if(context.length>8||all.length>32||new Set(all.map(p=>p.name.value)).size!==all.length)deny('context schema or parameter limit');
  if(!['->',':'].includes(v(pe+1))||!['int','bool'].includes(v(pe+2))||!exact(pe+3,['{','return']))deny('single scalar return required',tokens[pe]);
  let end=pe+5;while(end<tokens.length&&v(end)!==';')end++;
  if(!exact(end,[';','}','end','fnc','main','(',')','->','int','{']))deny('closed contextual class followed by main required',tokens[end]);
  const mainStart=end+10,mainEnd=tokens.length-2;
  if(v(mainEnd)!=='}'||tokens.at(-1).kind!=='eof')deny('closed main required');
  const ops=new Set(['+','-','*','/','(',')','==','!=','<','>','<=','>=','&&','||','!','^']);
  const plain=(part,locals)=>{
    if(!part.length)deny('empty scalar expression');
    let depth=0;
    return part.map(t=>{
      if(t.value==='(')depth++;
      if(t.value===')'&&--depth<0)deny('mismatched scalar delimiter',t);
      if(t.kind==='int'||(t.kind==='id'&&['true','false'].includes(t.value))||t.kind==='sym'&&ops.has(t.value))return t;
      if(id(t)&&locals.has(t.value))return ident(locals.get(t.value),t);
      deny('unsupported scalar operand or unresolved name',t);
    }).map((t,i,a)=>{if(i===a.length-1&&depth!==0)deny('unclosed scalar expression',t);return t;});
  };
  const methodNames=new Map(all.map(p=>[p.name.value,p.name.value]));
  const body=plain(tokens.slice(pe+5,end),methodNames);
  const anchor=tokens[6], fn=PREFIX+'member';
  const generatedParams=all.flatMap((p,i)=>[...(i?[sym(',',anchor)]:[]),p.type,p.name]);
  const out=[ident('fnc',anchor),ident(fn,anchor),sym('(',anchor),...generatedParams,sym(')',anchor),...tokens.slice(pe+1,pe+5),...body,...tokens.slice(end,end+2),
    ident('pub',anchor),...tokens.slice(end+3,mainStart)];
  const aliases=new Map(),locals=new Map(),writable=new Set();
  let slot=0;
  const local=(name,type,expr,t)=>out.push(ident('val',t),ident(type,t),ident(name,t),sym('=',t),...expr,sym(';',t));
  const emitArgs=(args,t)=>args.flatMap((p,j)=>[...(j?[sym(',',t)]:[]),...p]);
  const contextsAt=(i)=>{
    const close=pair(i+2);
    const parts=split(tokens.slice(i+3,close));
    if(parts.length!==context.length)deny('context arity mismatch',tokens[i]);
    return {close,args:parts.map(p=>plain(p,locals))};
  };
  const expression=(a,b)=>{
    const result=[];
    for(let i=a;i<b;){
      const t=tokens[i];const alias=aliases.get(v(i));
      if(v(i)===owner||alias){
        let dot=i+1,args;
        if(alias)args=alias.map(s=>[ident(s,t)]);
        else {if(v(i+1)!=='::')deny('explicit context binding required',t);const c=contextsAt(i);dot=c.close+1;args=c.args;}
        if(!exact(dot,['.',member,'(']))deny('only declared contextual member may be called',t);
        const close=pair(dot+2);if(close>=b)deny('contextual call crosses statement',t);
        const ordinaryArgs=split(tokens.slice(dot+3,close),true);
        if(ordinaryArgs.length!==ordinary.length)deny('ordinary argument arity mismatch',t);
        result.push(ident(fn,t),sym('(',t),...emitArgs([...args,...ordinaryArgs.map(p=>plain(p,locals))],t),sym(')',t));
        i=close+1;
      }else{
        if(id(t)&&locals.has(t.value))result.push(ident(locals.get(t.value),t));
        else if(t.kind==='int'||id(t)&&['true','false'].includes(t.value)||t.kind==='sym'&&ops.has(t.value))result.push(t);
        else deny('unsupported contextual main expression',t);
        i++;
      }
    }
    if(!result.length)deny('empty contextual main expression',tokens[a]);return result;
  };
  let i=mainStart,returned=false;
  while(i<mainEnd){
    let e=i;while(e<mainEnd&&v(e)!==';')e++;
    if(e===mainEnd||returned)deny('closed straight-line main required',tokens[i]);
    const t=tokens[i];
    if(['const','let'].includes(v(i))&&safe(tokens[i+1])&&v(i+2)==='='){
      const name=v(i+1);if(name===owner||aliases.has(name)||locals.has(name))deny('duplicate contextual local',t);
      if(v(i+3)===owner&&v(i+4)==='::'){
        const c=contextsAt(i+3);
        if(c.close+1===e){
          if(v(i)!=='const'||aliases.size>=64)deny('immutable context or binding limit',t);
          const slots=c.args.map((arg,j)=>{const s=PREFIX+'cap_'+slot++;local(s,context[j].type.value,arg,t);return s;});
          aliases.set(name,slots);if(out.length>maxTokens)deny('contextual token budget',t);i=e+1;continue;
        }
      }
      const rhs=expression(i+3,e),s=PREFIX+'local_'+slot++;
      local(s,'int',rhs,t);locals.set(name,s);if(v(i)==='let')writable.add(name);
    }else if(id(t)&&v(i+1)==='='&&writable.has(t.value)){
      const rhs=expression(i+2,e),s=PREFIX+'local_'+slot++;local(s,'int',rhs,t);locals.set(t.value,s);
    }else if(v(i)==='return'){
      out.push(t,...expression(i+1,e),tokens[e]);returned=true;
    }else deny('unsupported contextual statement or mutation',t);
    if(out.length>maxTokens)deny('contextual token budget',t);
    i=e+1;
  }
  if(!returned)deny('missing explicit return');
  out.push(...tokens.slice(mainEnd));
  if(out.length>maxTokens)deny('contextual token budget');
  return out;
}
