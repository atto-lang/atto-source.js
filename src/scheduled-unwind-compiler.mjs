// Explicit closed-world source profile; no general function/actor lowering.
// Use the production lexer and fixed numeric slots; never interpolate user names.
import {tokenizeCountedProfileSource} from './program-v2.mjs';
const MAX=(1n<<63n)-1n, MIN=-(1n<<63n);
const RESERVED=new Set(['pub','suspends','fnc','run','Future','int','defer','await','return','recover','let','val','const','borrow','mut','self','new','select','if','true','false','raise','throw','panic']);
class Parser {
  constructor(source){this.tokens=tokenizeCountedProfileSource(source);this.i=0;this.params=new Map();this.used=new Set();this.defers=[];}
  peek(){return this.tokens[this.i];}
  fail(message){const t=this.peek();throw new Error('E_SCHEDULED_UNWIND_PROFILE: '+message+' at '+t.line+':'+t.col);}
  eat(v){const t=this.peek();if((t.kind==='id'||t.kind==='sym')&&t.value===v){this.i++;return true;}return false;}
  need(v){if(!this.eat(v))this.fail('expected '+v);}
  name(){const t=this.peek();if(t.kind!=='id'||! /^[A-Za-z_][A-Za-z_0-9]*$/.test(t.value)||RESERVED.has(t.value))this.fail('lexical parameter required');this.i++;return t.value;}
  parse(){
    this.need('pub');this.need('suspends');this.need('fnc');this.need('run');this.need('(');
    do {
      if(this.params.size>=8)this.fail('parameter quota exceeded');
      this.need('Future');this.need('<');this.need('int');this.need('>');const n=this.name();
      if(this.params.has(n))this.fail('duplicate parameter');this.params.set(n,this.params.size);
    }while(this.eat(','));
    this.need(')');this.need(':');this.need('int');this.need('{');
    while(this.eat('defer')){
      this.need('await');const n=this.name();
      if(!this.params.has(n)||this.used.has(n))this.fail('expected unused Future<int> parameter');
      this.used.add(n);this.defers.push(this.params.get(n));this.need(';');
    }
    if(this.used.size!==this.params.size)this.fail('each Future<int> parameter must be consumed exactly once');
    this.need('return');const neg=this.eat('-');const t=this.peek();
    if(t.kind!=='int')this.fail('return requires a signed i64 literal');
    this.i++;const value=BigInt(t.value.replaceAll('_',''))*(neg?-1n:1n);
    if(value<MIN||value>MAX)this.fail('i64 literal overflow');
    this.need(';');this.need('}');if(this.peek().kind!=='eof')this.fail('trailing source');
    return {params:this.params.size,defers:this.defers,value};
  }
}
// AOT ESM, not eval or dynamic function construction. The trusted embedder
// passes the backend runtime module namespace; browser and Node use same bytes.
export function compileScheduledUnwindV1(source){
  const p=new Parser(source).parse();
  const registrations=p.defers.map(slot=>'  _ctx.register_scheduled_defer(()=>_rt.deferFuture(_ctx,_f['+slot+']));').join('\n');
  return 'export function start(_rt,_loop,_owner,_identity,_futures,_done){\n'+
    '  const _f=_rt.validateFutures(_futures,'+p.params+');\n'+
    '  const _ctx=_rt.createContext(_identity);\n  _ctx.push_frame(1);\n'+registrations+'\n'+
    '  return _ctx.return_frame_scheduled('+p.value+'n,_loop,_owner,_done);\n}\n';
}
