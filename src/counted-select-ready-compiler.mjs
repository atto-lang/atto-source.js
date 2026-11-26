// Explicit closed-world, ready-only source profile. NOT general async/actor lowering.
// Use the production lexer, typed lexical slots, checked arithmetic and real runtime.
// No user source text or identifiers are interpolated into ESM.
import {tokenizeCountedProfileSource} from './program-v2.mjs';
const MAX=(1n<<63n)-1n, MIN=-(1n<<63n);
const reserved=new Set('pub suspends fnc main int bool val let const Channel Future Array new writech readch select nb await when fair first random default over end return if then fi true false and or'.split(' '));
const expr=(type,code)=>({type,code});
class Parser {
  constructor(source){this.ts=tokenizeCountedProfileSource(source);this.i=0;this.slots=new Map();this.next=0;this.budget=4096;this.depth=0;this.counted=0;this.activeBatch=null;this.pureCondition=false;}
  peek(){return this.ts[this.i];}
  fail(msg){const t=this.peek();throw new Error('E_COUNTED_READY_PROFILE: '+msg+' at '+t.line+':'+t.col);}
  eat(v){if(['id','sym'].includes(this.peek().kind)&&this.peek().value===v){this.i++;return true;}return false;}
  need(v){if(!this.eat(v))this.fail('expected '+v);}
  name(){const t=this.peek();if(t.kind!=='id'||reserved.has(t.value))this.fail('lexical identifier required');this.i++;return t.value;}
  get(name,kind){const s=this.slots.get(name);if(!s||s.moved||s.type!==kind)this.fail('expected live lexical '+kind+' source');return s;}
  literal(){const t=this.peek();if(t.kind!=='int')this.fail('integer literal required');this.i++;const v=BigInt(t.value.replaceAll('_',''));if(v>MAX)this.fail('integer literal out of range');return v;}
  small(max){const n=this.literal();if(n>BigInt(max))this.fail('bounded literal exceeds profile limit');return Number(n);}
  type(){if(this.eat('int'))return 'int';if(this.eat('Channel')){this.need('<');this.need('int');this.need('>');return 'channel';}
    if(this.eat('Future')){if(!this.eat('<'))return 'inferFuture';if(this.eat('Array')){this.need('<');this.need('int');this.need('>');this.need('>');return 'futureArray';}this.need('int');this.need('>');return 'future';}
    if(this.eat('Array')){if(this.eat('[')){this.need('int');this.need(']');}else{this.need('<');this.need('int');this.need('>');}return 'array';}
    this.fail('unsupported lexical type');}
  check(v,t){if(v.type!==t)this.fail('expected '+t+' expression');return v.code;}
  expression(min=0,projector=null){
    if(--this.budget<0||++this.depth>64)this.fail('expression budget exceeded');
    try{
      let lhs=this.primary(projector);
      const prec={or:1,and:2,'==':3,'!=':3,'<':4,'>':4,'<=':4,'>=':4,'+':5,'-':5,'*':6};
      while(['id','sym'].includes(this.peek().kind)&&Object.hasOwn(prec,this.peek().value)&&prec[this.peek().value]>=min){
        const op=this.peek().value;this.i++;
        const rhs=this.expression(prec[op]+1,projector);
        if(['+','-','*'].includes(op))lhs=expr('int','_i(('+this.check(lhs,'int')+')'+op+'('+this.check(rhs,'int')+'))');
        else if(op==='and'||op==='or')lhs=expr('bool','(('+this.check(lhs,'bool')+')'+(op==='and'?'&&':'||')+'('+this.check(rhs,'bool')+'))');
        else lhs=expr('bool','(('+this.check(lhs,'int')+')'+(op==='=='?'===':op==='!='?'!==':op)+'('+this.check(rhs,'int')+'))');
      }
      return lhs;
    }finally{this.depth--;}
  }
  primary(projector){
    if(this.eat('(')){const e=this.expression(0,projector);this.need(')');return e;}
    if(this.eat('-')){if(this.peek().kind==='int'){const raw=this.peek().value;this.i++;const n=-BigInt(raw.replaceAll('_',''));if(n<MIN)this.fail('literal out of range');return expr('int',n+'n');}
      return expr('int','_i(-('+this.check(this.expression(7,projector),'int')+'))');}
    if(this.peek().kind==='int')return expr('int',this.literal()+'n');
    if(projector!==null){const n=this.name();if(projector==='@count')return expr('int',this.get(n,'int').slot);if(n!==projector)this.fail('projection may reference only its binding');return expr('int','_x');}
    if(this.eat('await')){
      if(this.pureCondition)this.fail('effect in condition');
      const legacy=this.eat('nb');
      if(this.eat('select')){
        if(this.activeBatch)this.fail('await outstanding counted batch first');
        return this.selectResult(true);
      }
      if(legacy)this.fail('nb requires select');
      const name=this.name(),s=this.slots.get(name);
      if(s?.type==='futureArray'&&!s.moved&&this.activeBatch===s.slot){
        s.moved=true;this.activeBatch=null;return expr('array','(await '+s.slot+')');
      }
      if(this.activeBatch)this.fail('await outstanding counted batch first');
      const future=this.get(name,'future');future.moved=true;return expr('int','_awaitReady('+future.slot+')');
    }
    if(this.eat('readch')){
      if(this.pureCondition)this.fail('effect in condition');
      if(this.activeBatch)this.fail('await outstanding counted batch before channel access');
      return expr('int','_read('+this.get(this.name(),'channel').slot+')');
    }
    const n=this.name(),s=this.slots.get(n);if(!s||s.moved)this.fail('unknown or moved lexical binding');
    if(s.type==='int')return expr('int',s.slot);
    if(s.type==='array'){
      if(this.eat('[')){const i=this.small(15);this.need(']');return expr('int','_at('+s.slot+','+i+')');}
      this.need('.');this.need('size');return expr('int','BigInt('+s.slot+'.length)');
    }
    this.fail('capability cannot escape scalar expression');
  }
  // Bounded caller-snapshotted scalar count; one outstanding tracked batch.
  // No external producer, arbitrary effect, or handle escape.
  countedSelect(direct){
    if(this.activeBatch)this.fail('await outstanding counted batch first');
    this.need('(');const count=this.check(this.expression(0,'@count'),'int');this.need(')');
    const literal=/^-?[0-9]+n$/.test(count)?BigInt(count.slice(0,-1)):null;
    if(literal!==null&&(literal<0n||literal>16n))this.fail('SelectCountInvalid');
    const policy=this.eat('fair')?'fair':(this.eat('first'),'first');
    const over=this.eat('over');if(!over)this.need('{');
    const cases=[],projects=[],futures=new Set();
    while(this.eat('when')){
      if(cases.length===8)this.fail('arm quota exceeded');
      const kind=this.eat('readch')?'channel':this.eat('await')?'future':this.fail('read/Future arm required');
      const s=this.get(this.name(),kind);
      if(kind==='future')futures.add(s);
      this.need(':');this.need('int');const binding=this.name();
      this.need('->');this.need('{');this.need('return');
      projects.push('(_x)=>'+this.check(this.expression(0,binding),'int'));
      this.need(';');this.need('}');cases.push(s.slot);
    }
    if(!cases.length)this.fail('counted select requires at least one arm');
    this.need(over?'end':'}');
    this.counted++;
    // Literal zero is static only: no source evaluation, capture or move.
    // Dynamic counts are conservatively affine; runtime validates the count
    // before materializing the source plan.
    if(literal!==0n)for(const s of futures)s.moved=true;
    const args=literal===0n?'0n,()=>[[],[]]':count+',()=>[['+cases.join(',')+'],['+projects.join(',')+']]';
    const code='_startBatch('+args+','+JSON.stringify(policy)+',_owned,_fence)';
    return direct?expr('array','(await '+code+')'):expr('futureArray',code);
  }
  // Called after select; infer only the two already-checked ready-only shapes.
  selectResult(direct){
    if(this.activeBatch)this.fail('await outstanding counted batch first');
    if(this.eat('<')){this.need('int');this.need('>');}
    if(this.peek().value==='(')return this.countedSelect(direct);
    const code=this.defaultFuture();
    return direct?expr('int','_awaitReady('+code+')'):expr('future',code);
  }
  defaultFuture(){
    const over=this.eat('over');if(!over)this.need('{');
    this.need('default');this.need(':');this.need('->');this.need('{');this.need('return');
    // Constant-only: no user calls or capture, no actor/scheduling claim.
    const value=this.check(this.expression(0,'$no_binding'),'int');
    this.need(';');this.need('}');this.need(over?'end':'}');
    return '_ready(()=>'+value+')';
  }
  binding(mutable=false){
    let type=this.type();const n=this.name();if(this.slots.has(n)||this.next>=128)this.fail('duplicate or excessive lexical binding');
    if(mutable&&type!=='int')this.fail('only scalar int mutation is admitted');
    this.need('=');let code;
    if(type==='channel'){if(this.activeBatch)this.fail('await outstanding counted batch first');this.need('Channel');this.need('.');this.need('new');this.need('<');this.need('int');this.need('>');this.need('(');
      const cap=this.small(64);if(cap===0)this.fail('zero channel capacity');this.need(')');code='new _Channel('+cap+')';}
    else if(type==='future'||type==='futureArray'||type==='inferFuture'){
      this.eat('nb');this.need('select');const selected=this.selectResult(false);
      if(type==='inferFuture')type=selected.type;
      code=this.check(selected,type);
    }
    else code=this.check(this.expression(),type);
    this.need(';');const slot='_v'+this.next++;this.slots.set(n,{slot,type,moved:false,mutable});
    if(type==='futureArray')this.activeBatch=slot;
    return (mutable?'let ':'const ')+slot+'='+code+';';
  }
  parse(){
    this.eat('pub');this.need('suspends');this.need('fnc');this.need('main');this.need('(');this.need(')');this.need(':');this.need('int');this.need('{');
    const stmts=[];
    while(this.peek().value!=='return'){
      if(stmts.length>=256)this.fail('statement quota exceeded');
      // Canonical immutable const and compatibility val share the same typed slot.
      if(this.eat('const')||this.eat('val'))stmts.push(this.binding());
      else if(this.eat('let'))stmts.push(this.binding(true));
      else if(this.eat('writech')){
        if(this.activeBatch)this.fail('await outstanding counted batch before channel access');
        const s=this.get(this.name(),'channel');this.need(',');const v=this.check(this.expression(),'int');this.need(';');stmts.push('_write('+s.slot+','+v+');');
      }else if(this.eat('if')){
        if(this.activeBatch)this.fail('await outstanding counted batch before branching');
        this.pureCondition=true;
        const condition=this.check(this.expression(),'bool');this.pureCondition=false;this.need('then');this.need('return');
        // Conditional return cannot consume a Future on only one exit and
        // then reuse it on the fallthrough. The return path is terminal.
        const saved=new Map([...this.slots].map(([n,s])=>[n,{...s}]));
        const value=this.check(this.expression(),'int');this.need(';');this.need('fi');this.slots=saved;
        stmts.push('if('+condition+')return '+value+';');
      }else if(this.peek().kind==='id'&&this.ts[this.i+1]?.value==='='){
        const s=this.get(this.name(),'int');if(!s.mutable)this.fail('cannot assign immutable binding');
        this.need('=');const value=this.check(this.expression(),'int');this.need(';');stmts.push(s.slot+'='+value+';');
      }else this.fail('unsupported statement in ready-only profile');
    }
    this.need('return');stmts.push('return '+this.check(this.expression(),'int')+';');this.need(';');this.need('}');
    if(this.activeBatch)this.fail('outstanding counted batch must be awaited');
    if(this.peek().kind!=='eof'||this.counted===0)this.fail('requires one closed-world counted guest main');
    return stmts.join('\n');
  }
}
const runtime = `import {SelectableI64Channel as _Channel} from '@atto-lang/source-js/selectable-i64-channel';
import {SelectableI64Future as _Future} from '@atto-lang/source-js/selectable-i64-future';
import {CountedSelectI64Batch as _Batch} from '@atto-lang/source-js/counted-select-i64-batch';
import {SelectContinuationFence as _Fence} from '@atto-lang/source-js/select-continuation-fence';
function _i(v){if(typeof v!=='bigint'||v<-(1n<<63n)||v>(1n<<63n)-1n)throw new RangeError('E_I64_OVERFLOW');return v;}
function _write(c,v){if(!c.tryWrite(v))throw new Error('E_READY_ONLY: channel write would suspend');}
function _read(c){const r=c.tryRead();if(!r.ok)throw new Error('E_READY_ONLY: channel read would suspend');return _i(r.value);}
function _at(a,i){if(i<0||i>=a.length)throw new RangeError('E_ARRAY_BOUNDS');return _i(a[i]);}
function _ready(project){const f=new _Future();try{f.resolve(_i(project()));}catch(e){f.fail(e);}return f;}
function _awaitReady(f){const s=f.subscribeReady(()=>{});try{const c=f.createResultCell();if(!f.tryCommit(s,c))throw new Error('E_READY_ONLY: Future would suspend');if(c.status!=='value')throw c.error??new Error('Future failed');return _i(c.value);}finally{s.close();}}
function _startBatch(count,plan,policy,owned,fence){
  if(typeof count!=='bigint'||count<0n||count>16n)throw new RangeError('SelectCountInvalid');
  const n=Number(count),[s,p]=n===0?[[],[]]:plan();
  // The invocation owns the physical driver, not just its logical result.
  const ticket=fence.register(),lease=fence.tryClaim(ticket);
  if(lease===null){ticket.close();throw new Error('counted guest execution admission failed');}
  try{
    const b=new _Batch(n,s,policy,p);
    const record={batch:b,cancelled:false,driver:null};
    owned.add(record);
    record.driver=(async()=>{
      try{return await _batch(record,n,s.length);}
      finally{lease.close();}
    })();
    record.driver.then(()=>owned.delete(record),()=>owned.delete(record));
    return record.driver;
  }catch(error){lease.close();throw error;}
}
async function _batch(record,n,arms){
  const b=record.batch,completion=b.completion;completion.catch(()=>{});
  let terminal=false;completion.then(()=>{terminal=true;},()=>{terminal=true;});
  try {
    await Promise.resolve();
    for(let i=0;!terminal&&!record.cancelled&&i<2*(n+arms)+2;i++){
      if(!b.pump()){b.cancel();throw new Error('E_READY_ONLY: counted selection would suspend');}
      await Promise.resolve();
    }
    if(record.cancelled)return await completion;
    if(!terminal){b.cancel();throw new Error('E_READY_ONLY: counted selection budget exceeded');}
    return await completion;
  }finally{if(!terminal&&!record.cancelled)b.cancel();}
}
// A failed main cannot leave a queued owner driver consuming channel data.
// Revoke first, then join all physical owner continuations before exiting.
async function _drain(owned,fence){
  fence.close();
  const pending=[...owned],errors=[];
  for(const record of pending){
    record.cancelled=true;
    try{record.batch.cancel();}catch(e){errors.push(e);}
  }
  await Promise.allSettled(pending.map(record=>record.driver));
  if(!fence.retirementReady)errors.push(new Error('counted guest physical execution not retired'));
  if(errors.length)throw new AggregateError(errors,'counted guest retirement failure');
}
`;
export function compileCountedReadyV1(source){
  const body=new Parser(source).parse();
  return runtime+'\nexport async function main(){\nconst _owned=new Set();\nconst _fence=new _Fence({maxTickets:128});\ntry {\n'+body+'\n}finally{await _drain(_owned,_fence);}\n}\n';
}
