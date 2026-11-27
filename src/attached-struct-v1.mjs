// Explicit, bounded attached-value source compiler. No host eval, dynamic property
// names, host-object arguments, native ABI, or zero-GC claim.
const fail=message=>{throw new Error('E_ATTACHED_STRUCT: '+message)};
const demand=(v,m)=>{if(!v)fail(m)};
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
const reserved=new Set('define struct type with constructor mtd mut int bool void let val return self pub fnc main true false copy new actor class task await suspends import export use namespace module if else while for defer recover unsafe take share borrow move destroy free alloc ref deref unref'.split(' '));
function tokens(source){
  demand(typeof source==='string'&&source.length<=65536,'source limit');
  demand(new TextEncoder().encode(source).length<=65536,'byte limit');
  demand(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u.test(source),'unsupported source controls');
  const out=[];let i=0;
  while(i<source.length){
    const rest=source.slice(i);let m;
    if((m=/^[ \t\r\n]+/.exec(rest))){i+=m[0].length;continue}
    if(rest.startsWith('//')){i+=2;while(i<source.length&&!/[\r\n]/.test(source[i]))i++;continue}
    if(rest.startsWith('/*')){i+=2;let d=1;while(i<source.length&&d){if(source.startsWith('/*',i)){demand(++d<=64,'comment depth');i+=2}else if(source.startsWith('*/',i)){d--;i+=2}else i++}demand(!d,'unterminated comment');continue}
    m=/^(?:copy!(?=[ \t\r\n])|[A-Za-z_][A-Za-z0-9_]*|[0-9]+|->|<-|&&|\|\||==|!=|<=|>=|[{}().,;:=+*\-<>•])/.exec(rest);
    demand(m,'unsupported token at '+i);demand(m[0].length<=128,'token length');out.push(m[0]);i+=m[0].length;
    demand(out.length<=8192,'token budget');
  }
  return out;
}
const scalar=t=>t==='int'||t==='bool';
const val=(type,code)=>({type,code});
const prec=new Map([['||',1],['&&',2],['==',3],['!=',3],['<',4],['<=',4],['>',4],['>=',4],['+',5],['-',5],['*',6]]);
class Reader{
  constructor(source){this.t=tokens(source);this.i=0;this.owners=new Map();this.values=new Map();this.code=[];this.nodes=0;this.members=0;}
  peek(){return this.t[this.i]}
  eat(t){if(this.peek()===t){this.i++;return true}return false}
  need(t){demand(this.eat(t),'expected '+t)}
  name(){const s=this.peek();demand(typeof s==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)&&!reserved.has(s),'identifier');this.i++;return s}
  type(){for(const t of ['int','bool'])if(this.eat(t))return t;const n=this.name();demand(this.owners.has(n),'unknown/recursive nominal type');return n}
  leaves(t){return scalar(t)?[{path:'',type:t}]:this.owners.get(t).leaves}
  formals(){this.need('(');const f=[];if(!this.eat(')')){do{const type=this.type(),name=this.name();demand(!f.some(x=>x.name===name)&&!this.owners.has(name),'duplicate formal');f.push({type,name});demand(f.reduce((n,x)=>n+this.leaves(x.type).length,0)<=8,'formal budget')}while(this.eat(','));this.need(')')}return f}
  path(){let n=this.name();while(this.eat('.')){n+='.'+this.name();demand(n.length<=1024,'path budget')}return n}
  decl(){
    let name;if(this.eat('define')){this.need('struct');name=this.name()}else{this.need('type');name=this.name();this.need('=');this.need('struct')}
    demand(!this.owners.has(name)&&this.owners.size<16,'duplicate owner/limit');
    const o={name,index:this.owners.size,fields:[],leaves:[],ctors:[],methods:new Map()};this.need('{');
    while(!this.eat('}')){const type=this.type(),field=this.name();this.need(';');demand(!o.fields.some(f=>f.name===field),'duplicate field');o.fields.push({name:field,type});for(const l of this.leaves(type))o.leaves.push({path:field+(l.path?'.'+l.path:''),type:l.type});demand(o.leaves.length<=8,'leaf limit')}
    demand(o.fields.length,'empty struct');
    do{this.need('with');if(this.eat('{')){demand(this.peek()!=='}','empty attachment');while(!this.eat('}'))this.member(o)}else this.member(o)}while(this.peek()==='with');
    demand(o.ctors.length,'constructor required');this.owners.set(name,o);
  }
  member(o){
    demand(++this.members<=64,'member limit');
    if(this.eat('constructor')){
      const f=this.formals(),assign=new Map();demand(!o.ctors.some(c=>c.formals.map(x=>x.type).join(',')===f.map(x=>x.type).join(',')),'duplicate constructor');
      this.need('{');while(!this.eat('}')){this.need('self');this.need('.');const field=this.name();this.need('=');const param=this.name();this.need(';');const a=o.fields.find(x=>x.name===field),j=f.findIndex(x=>x.name===param);demand(a&&j>=0&&a.type===f[j].type&&!assign.has(field),'invalid initialization');assign.set(field,j)}
      demand(assign.size===o.fields.length,'missing initialization');
      const id='_c'+o.index+'_'+o.ctors.length;
      const params=f.map((_,i)=>'_a'+i);
      const slots=[];for(const field of o.fields){const j=assign.get(field.name);if(scalar(field.type))slots.push(params[j]);else for(let k=0;k<this.leaves(field.type).length;k++)slots.push(params[j]+'['+k+']')}
      this.code.push('function '+id+'('+params.join(',')+'){return ['+slots.join(',')+'];}');o.ctors.push({formals:f,id});return;
    }
    const mut=this.eat('mut');this.need('mtd');let name,f,result;
    if(['int','bool','void'].includes(this.peek())){result=this.peek();this.i++;demand(this.eat('•')||this.eat('<-')||this.eat('*'),'return marker');name=this.name();f=this.formals()}
    else{name=this.name();f=this.formals();demand(this.eat('->')||this.eat(':'),'result marker');result=this.eat('void')?'void':this.type()}
    demand(!o.methods.has(name)&&f.every(x=>scalar(x.type)),'method profile');demand(o.leaves.length+f.length<=8,'method frame budget');
    const env={self:o,params:new Map(f.map((x,i)=>[x.name,val(x.type,'_a'+i)]))};const id='_m'+o.index+'_'+o.methods.size;const params=['_self',...f.map((_,i)=>'_a'+i)];let body=[];
    this.need('{');
    if(mut){demand(result==='void','mutable result');while(!this.eat('}')){if(this.eat('return')){this.need(';');this.need('}');break}this.need('self');this.need('.');const path=this.path(),i=o.leaves.findIndex(l=>l.path===path);demand(i>=0,'unknown field');this.need('=');const e=this.expr(env);this.need(';');demand(e.type===o.leaves[i].type,'mutation type');body.push('_self['+i+']='+e.code+';');demand(body.length<=16,'write budget')}demand(body.length,'empty mutable method')}
    else{demand(scalar(result)&&f.length===0,'readonly profile');this.need('return');const e=this.expr(env);demand(e.type===result,'return type');this.need(';');this.need('}');body.push('return '+e.code+';')}
    o.methods.set(name,{id,mut,result,formals:f});this.code.push('function '+id+'('+params.join(',')+'){'+body.join('')+'}');
  }
  expr(env,min=1,depth=0){
    demand(depth<32&&++this.nodes<=1024,'expression budget');let a=this.atom(env,depth+1),links=0;
    while((prec.get(this.peek())??0)>=min){demand(++links<=16,'operator chain');const op=this.peek(),p=prec.get(op);this.i++;const b=this.expr(env,p+1,depth+1);demand(a.type===b.type&&scalar(a.type),'operand types');let result;
      if(['+','-','*'].includes(op)){demand(a.type==='int','integer operator');result=val('int','_checked(('+a.code+')'+op+'('+b.code+'))')}
      else if(['&&','||'].includes(op)){demand(a.type==='bool','boolean operator');result=val('bool','(('+a.code+')'+op+'('+b.code+'))')}
      else{demand(['==','!='].includes(op)||a.type==='int','comparison type');result=val('bool','(('+a.code+')'+(op==='=='?'===':op==='!='?'!==':op)+'('+b.code+'))')}a=result;
    }return a
  }
  atom(env,depth){
    if(this.eat('(')){const a=this.expr(env,1,depth);this.need(')');return a}
    if(this.eat('-')){if(this.peek()==='9223372036854775808'){this.i++;return val('int','(-9223372036854775808n)')}const a=this.expr(env,7,depth);demand(a.type==='int','negative type');return val('int','_checked(-('+a.code+'))')}
    if(this.eat('true'))return val('bool','true');if(this.eat('false'))return val('bool','false');
    if(/^[0-9]+$/.test(this.peek()??'')){const n=this.peek();this.i++;demand(n.length<=19&&BigInt(n)<=MAX,'integer range');return val('int',BigInt(n).toString()+'n')}
    if(env){
      if(this.eat('self')){this.need('.');const path=this.path(),i=env.self.leaves.findIndex(l=>l.path===path);demand(i>=0,'unknown self leaf');return val(env.self.leaves[i].type,'_self['+i+']')}
      const n=this.name();demand(env.params.has(n),'unknown parameter');return env.params.get(n)
    }
    const n=this.name(),v=this.values.get(n);demand(v,'unknown value');const o=this.owners.get(v.type);
    this.need('.');const first=this.name();
    if(this.eat('(')){this.need(')');const m=o.methods.get(first);demand(m&&!m.mut&&m.formals.length===0,'readonly method');return val(m.result,m.id+'('+v.code+')')}
    let path=first;while(this.eat('.'))path+='.'+this.name();
    const i=o.leaves.findIndex(l=>l.path===path);demand(i>=0,'unknown field');return val(o.leaves[i].type,v.code+'['+i+']')
  }
  operand(){const v=this.values.get(this.peek());if(v&&this.t[this.i+1]!=='.'){this.i++;return val(v.type,v.code)}return this.expr(null)}
  bind(){
    this.need('let');const mut=this.eat('mut');let name=this.name(),annotation=null;if(this.owners.has(name)){annotation=name;name=this.name()}
    demand(!this.values.has(name)&&!this.owners.has(name)&&this.values.size<64,'binding identity/limit');this.need('=');const copy=this.eat('copy!');let type,code;
    const prior=this.values.get(this.peek());
    if(prior&&this.t[this.i+1]!=='.'){this.i++;type=prior.type;code=prior.code+'.slice()'}
    else{demand(!copy,'copy operand');type=this.name();const o=this.owners.get(type);demand(o,'unknown owner');this.need('(');const args=[];if(!this.eat(')')){do{demand(args.length<8,'argument limit');args.push(this.operand())}while(this.eat(','));this.need(')')}const c=o.ctors.find(c=>c.formals.length===args.length&&c.formals.every((x,i)=>x.type===args[i].type));demand(c,'constructor identity');code=c.id+'('+args.map(a=>a.code).join(',')+')'}
    demand(!annotation||annotation===type,'binding nominal identity');this.need(';');const id='_v'+this.values.size;this.values.set(name,{type,code:id,mut});return 'const '+id+'='+code+';'
  }
  invoke(){const n=this.name(),v=this.values.get(n);demand(v?.mut,'immutable receiver');this.need('.');const name=this.name(),m=this.owners.get(v.type).methods.get(name);demand(m?.mut,'mutable method');this.need('(');const args=[];if(!this.eat(')')){do{demand(args.length<m.formals.length,'mutation arity');const a=this.expr(null);demand(a.type===m.formals[args.length].type,'mutation type');args.push(a.code)}while(this.eat(','));this.need(')')}demand(args.length===m.formals.length,'mutation arity');this.need(';');return m.id+'('+[v.code,...args].join(',')+');'}
  finish(){
    while(['define','type'].includes(this.peek()))this.decl();demand(this.owners.size,'owner required');this.eat('pub');this.need('fnc');this.need('main');this.need('(');this.need(')');demand(this.eat('->')||this.eat(':'),'main result');this.need('int');this.need('{');const statements=[];
    while(this.peek()!=='return'){demand(statements.length<128,'statement limit');statements.push(this.peek()==='let'?this.bind():this.invoke())}
    this.need('return');const e=this.expr(null);demand(e.type==='int','main result type');this.need(';');this.need('}');demand(this.i===this.t.length,'trailing source');
    return ['// Checked attached struct ESM v1; flattened private scalar values.',
      'function _checked(v){if(v<-(1n<<63n)||v>(1n<<63n)-1n)throw new RangeError("E_OVERFLOW");return v;}',
      ...this.code,'export function main(){'+statements.join('')+'return '+e.code+';}'].join('\n')+'\n';
  }
}
export function compileAttachedStruct(source){return new Reader(source).finish()}
