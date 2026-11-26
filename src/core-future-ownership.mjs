// Compiler-core sealed Future-family negative preflight.
// Not a generic borrow-checker, suspending guest compiler or actor runtime.
// Even valid owned Future source MUST fail closed until typed affine IR exists.
const sealedNames=new Set(['Future','TaskFuture','ActorFuture']);
// Match Worker admission: no guest nominal form may redeclare a sealed receipt.
const reservedIntroducers=new Set(['new','class','actor','struct','enum','contract','interface','trait','type','alias','namespace','module','record']);
const value=(tokens,i)=>tokens[i]?.value;
const future=(tokens,i)=>tokens[i]?.kind==='id'&&sealedNames.has(tokens[i]?.value);
function close(tokens,start,open,ending,fail){
  let depth=0;
  for(let i=start;i<tokens.length;i++){
    if(value(tokens,i)===open)depth++;
    if(value(tokens,i)===ending){
      if(depth===0)fail('E_SYNTAX','unbalanced Future signature',tokens[i]);
      depth--;
      if(depth===0)return i;
    }
    if(depth>128)fail('E_NESTING','Future signature nesting exceeds compiler core budget',tokens[start]);
  }
  fail('E_EOF','unterminated Future signature',tokens[start]);
}
function formal(tokens,start,end,fail){
  let receipt=null;
  for(let i=start;i<end;i++){
    if(!future(tokens,i)||value(tokens,i+1)!=='<')continue;
    if(receipt)fail('E_UNSUPPORTED_TYPE','multiple sealed Future types per formal are not lowered',tokens[i]);
    const endType=close(tokens,i+1,'<','>',fail);
    if(endType>=end||tokens[endType+1]?.kind!=='id')
      fail('E_SYNTAX','Future receipt requires a named formal',tokens[i]);
    const name=value(tokens,endType+1);
    const owned=Array.from({length:i-start},(_,k)=>start+k)
      .some(k=>value(tokens,k)==='take'&&value(tokens,k+1)==='!');
    receipt={name,owned,token:tokens[i]};
  }
  return receipt;
}
function body(tokens,start,end,receipts,fail){
  for(const receipt of receipts){
    let moved=false,loan=false;
    for(let i=start;i<end;){
      const isName=j=>value(tokens,j)===receipt.name&&tokens[j]?.kind==='id';
      if(value(tokens,i)==='borrow'&&value(tokens,i+1)==='!'&&isName(i+2)){
        if(moved)fail('E_MOVED','cannot borrow a consumed Future receipt',tokens[i]);
        loan=true;i+=3;continue;
      }
      if(value(tokens,i)==='take'&&value(tokens,i+1)==='!'&&isName(i+2)){
        if(!receipt.owned)fail('E_OWNERSHIP','cannot transfer a borrowed Future receipt',tokens[i]);
        if(moved)fail('E_MOVED','Future receipt was already moved',tokens[i]);
        if(loan)fail('E_BORROW','cannot move Future while a loan is live',tokens[i]);
        moved=true;i+=3;continue;
      }
      if(value(tokens,i)==='await'&&isName(i+1)){
        if(!receipt.owned)fail('E_OWNERSHIP','await requires take! Future formal',tokens[i]);
        if(moved)fail('E_MOVED','Future receipt already awaited/moved',tokens[i]);
        if(loan)fail('E_BORROW','Future loan across consuming await',tokens[i]);
        moved=true;i+=2;continue;
      }
      if(moved&&isName(i))fail('E_MOVED','Future receipt used after await/take!',tokens[i]);
      i++;
    }
  }
}
export function preflightCoreFutureOwnership(tokens,fail){
  if(!Array.isArray(tokens)||typeof fail!=='function')
    throw new TypeError('compiler-owned token array and diagnostic callback required');
  let seen=false;
  for(let i=0;i<tokens.length;i++){
    if(future(tokens,i)&&value(tokens,i+1)==='<')seen=true;
    if(tokens[i]?.kind==='id'&&reservedIntroducers.has(value(tokens,i))&&future(tokens,i+1))
      fail('E_RESERVED','sealed Future types cannot be constructed or declared by guest code',tokens[i]);
  }
  if(!seen)return;
  for(let i=0;i<tokens.length;){
    if(value(tokens,i)!=='fnc'||tokens[i]?.kind!=='id'||tokens[i+1]?.kind!=='id'){i++;continue;}
    let at=i+2;
    if(value(tokens,at)==='<')at=close(tokens,at,'<','>',fail)+1;
    if(value(tokens,at)!=='('){i++;continue;}
    const endParams=close(tokens,at,'(',')',fail);
    const receipts=[];
    let start=at+1,angle=0;
    for(let j=start;j<=endParams;j++){
      if(j<endParams){
        if(value(tokens,j)==='<')angle++;
        if(value(tokens,j)==='>')angle=Math.max(0,angle-1);
      }
      if(j===endParams||(value(tokens,j)===','&&angle===0)){
        const r=formal(tokens,start,j,fail);
        if(r)receipts.push(r);
        start=j+1;
      }
    }
    let begin=endParams+1;
    while(begin<tokens.length&&!['{',';','<eof>'].includes(value(tokens,begin)))begin++;
    if(value(tokens,begin)==='{'){
      const end=close(tokens,begin,'{','}',fail);
      body(tokens,begin+1,end,receipts,fail);
      i=end+1;
    }else i=begin+1;
  }
  fail('E_UNSUPPORTED_TYPE',
    'Future/TaskFuture/ActorFuture require typed affine IR, suspension and trusted runtime; no JS guest emitted',
    tokens[0]);
}
