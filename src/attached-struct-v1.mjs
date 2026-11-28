// Explicit, bounded attached-value source compiler. No host eval, dynamic property
// names, host-object arguments, native ABI, or zero-GC claim.
import {planContextualMake} from './contextual-struct-construction.mjs';
import {bindBundle,refineInferred} from './parametric-bundle.mjs';
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
    m=/^(?:copy!(?=[ \t\r\n])|[A-Za-z_][A-Za-z0-9_]*|[0-9]+|->|<-|&&|\|\||==|!=|<=|>=|[{}\[\]().,;:=+*\-<>•])/.exec(rest);
    demand(m,'unsupported token at '+i);demand(m[0].length<=128,'token length');out.push(m[0]);i+=m[0].length;
    demand(out.length<=8192,'token budget');
  }
  return out;
}
const scalar=t=>t==='int'||t==='bool';
const val=(type,code)=>({type,code});
const prec=new Map([['||',1],['&&',2],['==',3],['!=',3],['<',4],['<=',4],['>',4],['>=',4],['+',5],['-',5],['*',6]]);
class Reader{
  constructor(source){this.t=tokens(source);this.i=0;this.owners=new Map();this.values=new Map();this.code=[];this.nodes=0;this.members=0;this.seed=null;this.capture=null;this.array=null;}
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
      this.code.push('function '+id+'('+params.join(',')+'){return ['+slots.join(',')+'];}');o.ctors.push({formals:f,id,fieldParams:o.fields.map(field=>assign.get(field.name))});return;
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
    const n=this.name();
    if(this.array&&(n===this.seed.name||n===this.capture.name)){
      this.need('.');this.need('size');return val('int',String(n===this.seed.name?this.seed.size:this.capture.size)+'n');
    }
    if(this.array&&n===this.array.name){
      this.need('.');this.need('columns');this.need('.');const field=this.path(),slot=this.array.fields.indexOf(field);
      demand(slot>=0,'unknown array column');const row=this.fixedIndex(this.array.size);
      return val('int',this.array.id+'['+this.arrayOffset(slot,row)+']');
    }
    const v=this.values.get(n);demand(v,'unknown value');const o=this.owners.get(v.type);
    this.need('.');const first=this.name();
    if(this.eat('(')){this.need(')');const m=o.methods.get(first);demand(m&&!m.mut&&m.formals.length===0,'readonly method');return val(m.result,m.id+'('+v.code+')')}
    let path=first;while(this.eat('.'))path+='.'+this.name();
    const i=o.leaves.findIndex(l=>l.path===path);demand(i>=0,'unknown field');return val(o.leaves[i].type,v.code+'['+i+']')
  }
  operand(){const v=this.values.get(this.peek());if(v&&this.t[this.i+1]!=='.'){this.i++;return val(v.type,v.code)}return this.expr(null)}
  makeValue(expected,depth=0,destination=false){
    demand(depth<16&&++this.nodes<=1024,'contextual construction depth/node budget');
    this.need('make');const type=this.peek()==='{'?expected:this.name();
    const o=this.owners.get(type);demand(o&&(!expected||expected===type),'missing or incompatible expected nominal owner');
    this.need('{');const entries=[];
    if(!this.eat('}')){do{
      demand(entries.length<8,'field budget');const name=this.name(),field=o.fields.find(f=>f.name===name);
      demand(field&&!entries.some(e=>e.name===name),'unknown or duplicate contextual field');this.need(':');
      if(this.peek()==='new')fail('reference construction cannot initialize an attached value struct');
      const nested=this.peek()==='make'&&(this.t[this.i+1]==='{'||this.t[this.i+2]==='{');
      const value=nested?this.makeValue(field.type,depth+1,destination):this.operand();
      demand(value.type===field.type,'contextual field type mismatch');entries.push({name,type:value.type,code:value.code,leaves:value.leaves});
    }while(this.eat(','));this.need('}')}
    const plan=planContextualMake(o,entries);
    // Every level must select a unique bijective fieldwise constructor.
    // Flatten nested value leaves in lexical initializer order; existing
    // values are snapshotted as scalars, not aliased or cloned as row arrays.
    if(destination){
      demand(o.leaves.every(f=>f.type==='int'),'direct row requires int leaves');
      const leaves=[];
      for(const e of entries){
        if(e.type==='int'){leaves.push({name:e.name,code:e.code});continue}
        const child=e.leaves??this.leaves(e.type).map((l,i)=>({name:l.path,code:e.code+'['+i+']'}));
        for(const l of child)leaves.push({name:e.name+'.'+l.name,code:l.code});
      }
      demand(leaves.length===o.leaves.length&&new Set(leaves.map(l=>l.name)).size===leaves.length&&leaves.every(l=>o.leaves.some(f=>f.path===l.name)),'invalid flattened row');
      return {type,leaves};
    }
    const params=entries.map((_,i)=>'_f'+i);
    return val(type,'(('+params.join(',')+')=>'+plan.id+'('+plan.order.map(i=>params[i]).join(',')+'))('+entries.map(e=>e.code).join(',')+')');
  }
  // Count the complete syntactic argument list before contextual inference.
  // Nested delimiters and comments are already tokenized. This scan never
  // parses or evaluates an initializer, and consumes no input.
  constructorArity(){
    if(this.peek()===')')return 0;
    const stack=[];let count=1,content=false;
    for(let i=this.i;i<this.t.length;i++){
      const token=this.t[i];
      if(token==='('||token==='{'){stack.push(token==='('?')':'}');content=true;demand(stack.length<=64,'constructor argument depth');continue}
      if(token===')'||token==='}'){
        if(stack.length){demand(stack.pop()===token,'constructor argument delimiter');continue}
        demand(token===')'&&content,'constructor argument delimiter');return count;
      }
      if(token===','&&!stack.length){demand(content&&++count<=8,'constructor argument limit');content=false;continue}
      content=true;
    }
    fail('unterminated constructor arguments');
  }
  constructorOperand(owner,prior,arity){
    if(this.peek()==='new')fail('reference construction cannot initialize an attached value argument');
    if(this.peek()!=='make'||(this.t[this.i+1]!=='{'&&this.t[this.i+2]!=='{'))return this.operand();
    // Only context shared by all viable prefix signatures may supply an
    // omitted owner. Later arguments never retroactively guess its identity.
    const viable=owner.ctors.filter(c=>c.formals.length===arity&&c.formals.length>prior.length&&prior.every((a,i)=>a.type===c.formals[i].type));
    const expected=new Set(viable.map(c=>c.formals[prior.length].type));
    if(this.t[this.i+1]==='{')demand(expected.size===1,'ambiguous or missing contextual constructor argument owner');
    const made=this.makeValue(expected.size===1?[...expected][0]:null);
    demand(expected.has(made.type),'contextual constructor argument type mismatch');
    return made;
  }
  bundleName(){const n=this.name();demand(!this.owners.has(n)&&!this.values.has(n)&&!['Array','infer','from','make','size','layout','T','Option','Result','Pointer','Vector','List','Map','Set','String','Symbol','Future','Channel'].includes(n),'invalid bundle identifier');return n}
  sizeLiteral(){const n=this.peek();demand(/^[0-9]+$/.test(n??'')&&n.length<=4&&Number(n)<=1024,'invalid fixed array size');this.i++;return Number(n)}
  seedBundle(){
    demand(!this.seed,'only one seed bundle');this.need('type');const name=this.bundleName();this.need('=');this.need('<');const args=[];
    do{demand(args.length<3,'bundle formal limit');const key=this.name();this.need('=');const value=key==='size'?this.sizeLiteral():this.name();args.push([key,value])}while(this.eat(','));
    this.need('>');this.need(';');
    const schema=[{name:'T',accepts:n=>this.owners.has(n)},{name:'size',accepts:n=>Number.isInteger(n)&&n>=0&&n<=1024},{name:'layout',accepts:n=>n==='soa'||n==='aos'}];
    const values=bindBundle(schema,[],args,'application');demand(values.length===3,'incomplete seed bundle');const o=Object.fromEntries(values);
    demand(this.owners.get(o.T).leaves.every(f=>f.type==='int'),'only int array leaves');this.seed={name,schema,values,...o};
  }
  fixedIndex(size){this.need('[');const i=this.sizeLiteral();this.need(']');demand(i<size,'array bounds');return i}
  arrayOffset(field,row){const a=this.array;return a.layout==='soa'?field*a.size+row:row*a.fields.length+field}
  bindArray(){
    demand(this.seed&&!this.array,'one seeded array required');this.need('let');const name=this.bundleName();demand(name!==this.seed.name,'array conflicts with seed');this.need(':');this.need('Array');this.need('<');this.need('infer');const capture=this.bundleName();demand(capture!==name&&capture!==this.seed.name,'bundle capture collision');this.need('from');this.need(this.seed.name);this.need('>');this.need('=');this.need('[');
    const rows=[];if(!this.eat(']')){do{demand(rows.length<1024,'array row limit');demand(this.peek()==='make','inline array requires value construction');rows.push(this.makeValue(this.seed.T,0,true).leaves)}while(this.eat(','));this.need(']')}
    let values=this.seed.values;if(this.eat('with')){this.need('{');this.need('size');this.need('=');values=this.eat('infer')?refineInferred(this.seed.schema,this.seed.values,[],['size'],[['size',rows.length]]):bindBundle(this.seed.schema,this.seed.values,[['size',this.sizeLiteral()]],'refinement');this.need('}')}
    this.need(';');const {size,layout}=Object.fromEntries(values);demand(size===rows.length,'fixed size must equal explicit row count');
    const fields=this.owners.get(this.seed.T).leaves.map(f=>f.path),id='_array';this.capture={name:capture,size};this.array={name,id,fields,size,layout};
    let code='const '+id+'=new BigInt64Array('+size*fields.length+');';
    for(const [row,entries] of rows.entries()){
      // Evaluate every initializer exactly once in written order, before any
      // store for that row. The destination is private until initialization
      // finishes; do not create an intermediate row array or invoke a ctor.
      code+='{';
      for(const [i,e] of entries.entries())code+='const _f'+i+'='+e.code+';';
      for(const [i,e] of entries.entries())code+=id+'['+this.arrayOffset(fields.indexOf(e.name),row)+']=_f'+i+';';
      code+='}';
    }
    return code;
  }
  mutateArray(){const a=this.array;this.need(a.name);const row=this.fixedIndex(a.size);this.need('.');const field=a.fields.indexOf(this.path());demand(field>=0,'unknown array field');this.need('+');this.need('=');const delta=this.expr(null);demand(delta.type==='int','array mutation type');this.need(';');const cell=a.id+'['+this.arrayOffset(field,row)+']';return cell+'=_checked('+cell+'+('+delta.code+'));'}
  bind(){
    if(this.t[this.i+2]===':'&&this.t[this.i+3]==='Array')return this.bindArray();
    this.need('let');const mut=this.eat('mut');let name=this.name(),annotation=null;if(this.eat(':')){annotation=this.type();demand(this.owners.has(annotation),'expected nominal value type')}else if(this.owners.has(name)){annotation=name;name=this.name()}
    demand(!this.values.has(name)&&!this.owners.has(name)&&name!==this.seed?.name&&name!==this.capture?.name&&name!==this.array?.name&&this.values.size<64,'binding identity/limit');this.need('=');const copy=this.eat('copy!');let type,code;
    const prior=this.values.get(this.peek());
    if(this.peek()==='new')fail('reference construction cannot initialize an attached value struct');
    if(this.peek()==='make' && (this.t[this.i+1]==='{' || this.t[this.i+2]==='{')){
      demand(!copy,'copy operand');const made=this.makeValue(annotation);type=made.type;code=made.code;
    }
    else if(prior&&this.t[this.i+1]!=='.'){this.i++;type=prior.type;code=prior.code+'.slice()'}
    else{demand(!copy,'copy operand');type=this.name();const o=this.owners.get(type);demand(o,'unknown owner');this.need('(');const arity=this.constructorArity(),args=[];if(!this.eat(')')){do{demand(args.length<8,'argument limit');args.push(this.constructorOperand(o,args,arity))}while(this.eat(','));this.need(')')}const c=o.ctors.find(c=>c.formals.length===args.length&&c.formals.every((x,i)=>x.type===args[i].type));demand(c,'constructor identity');code=c.id+'('+args.map(a=>a.code).join(',')+')'}
    demand(!annotation||annotation===type,'binding nominal identity');this.need(';');const id='_v'+this.values.size;this.values.set(name,{type,code:id,mut});return 'const '+id+'='+code+';'
  }
  invoke(){const n=this.name(),v=this.values.get(n);demand(v?.mut,'immutable receiver');this.need('.');const name=this.name(),m=this.owners.get(v.type).methods.get(name);demand(m?.mut,'mutable method');this.need('(');const args=[];if(!this.eat(')')){do{demand(args.length<m.formals.length,'mutation arity');const a=this.expr(null);demand(a.type===m.formals[args.length].type,'mutation type');args.push(a.code)}while(this.eat(','));this.need(')')}demand(args.length===m.formals.length,'mutation arity');this.need(';');return m.id+'('+[v.code,...args].join(',')+');'}
  finish(){
    while(['define','type'].includes(this.peek())){if(this.peek()==='type'&&this.t[this.i+2]==='='&&this.t[this.i+3]==='<')this.seedBundle();else{demand(!this.seed,'nominal declarations must precede seed');this.decl()}}demand(this.owners.size,'owner required');this.eat('pub');this.need('fnc');this.need('main');this.need('(');this.need(')');demand(this.eat('->')||this.eat(':'),'main result');this.need('int');this.need('{');const statements=[];
    while(this.peek()!=='return'){demand(statements.length<128,'statement limit');statements.push(this.peek()==='let'?this.bind():this.array&&this.peek()===this.array.name?this.mutateArray():this.invoke())}
    this.need('return');const e=this.expr(null);demand(e.type==='int','main result type');this.need(';');this.need('}');demand(this.i===this.t.length,'trailing source');
    return ['// Checked attached struct ESM v1; flattened private scalar values.',
      'function _checked(v){if(v<-(1n<<63n)||v>(1n<<63n)-1n)throw new RangeError("E_OVERFLOW");return v;}',
      ...this.code,'export function main(){'+statements.join('')+'return '+e.code+';}'].join('\n')+'\n';
  }
}
export function compileAttachedStruct(source){return new Reader(source).finish()}
