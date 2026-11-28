import {missingBangKeywordSeparator} from './bang-keyword-separator.mjs';
import {createScalarIR, validateScalarIR} from './scalar-ir.mjs';
import {startsBareSequence, readSequence, readCallArguments} from './sequence-syntax.mjs';
import {rejectExecutionDomains} from './execution-domain-admission.mjs';
import {rejectUnsupportedHttpActors} from './http-actor-admission.mjs';
import {scanStringLiteral} from './string-literal-syntax.mjs';
import {preflightCoreFutureOwnership} from './core-future-ownership.mjs';
/** Experimental fail-closed Oreslang scalar-to-ESM compiler. */
const MAX_BYTES = 262144;
const I64_MAX = (1n << 63n) - 1n;
export class CompileError extends Error {
  constructor(message, where) {
    super('error: ' + message + (where ? ' at ' + where.line + ':' + where.col : ''));
    this.name = 'CompileError';
  }
}
function validateSourceText(src) {
  if (typeof src !== 'string' || src.length > MAX_BYTES)
    throw new CompileError('invalid or oversized source');
  // UTF-8 bytes cannot be fewer than valid UTF-16 source code units.
  // Reject obviously oversize source before scanning/allocating its encoding.
  // TextEncoder silently replaces unpaired UTF-16 surrogates with U+FFFD.
  // Reject them (and NUL) everywhere, including comments, before encoding.
  for (let i=0; i<src.length; i++) {
    const code=src.charCodeAt(i);
    if (code===0) throw new CompileError('NUL in source');
    if (code===0x1b || code===0x7f)
      throw new CompileError('terminal control in source at UTF-16 offset '+i);
    // Trojan Source: bidi format controls can reorder displayed source,
    // including comments and literals that the lexer would otherwise skip.
    if (code===0x061c || code===0x200e || code===0x200f ||
        (code>=0x202a && code<=0x202e) ||
        (code>=0x2066 && code<=0x2069))
      throw new CompileError('bidirectional Unicode control in source');
    if (code>=0xd800 && code<=0xdbff) {
      const lo=src.charCodeAt(i+1);
      if (!(lo>=0xdc00 && lo<=0xdfff)) throw new CompileError('invalid UTF-16 in source');
      i++;
    } else if (code>=0xdc00 && code<=0xdfff) {
      throw new CompileError('invalid UTF-16 in source');
    }
  }
  if (new TextEncoder().encode(src).byteLength > MAX_BYTES)
    throw new CompileError('invalid or oversized source');
}
function lex(src) {
  validateSourceText(src);
  const out = [];
  let i=0, line=1, col=1;
  let ownershipBang;
  const lineEnd=c=>c==='\n'||c==='\r'||c==='\u0085'||c==='\u2028'||c==='\u2029';
  function advance() {
    const ch=src[i];
    if(lineEnd(ch)){if(ch!=='\n'||src[i-1]!=='\r')line++;col=1;}
    else col++;
    i++;
  }
  function add(kind, value, loc) { if(out.length>=30000) throw new CompileError('token limit exceeded'); out.push({kind,value,...loc,endLine:line}); }
  while(i<src.length){
    if(/\s/.test(src[i])||src[i]==='\u0085') {advance();continue;}
    if(src.startsWith('//',i)){
      // Checked signed-i64 source cannot be silently compiled by the legacy
      // scalar-v1 profile: this emitter currently wraps instead of trapping.
      // Only an actual line-comment directive counts; block comments and
      // other prose must not turn on or mask a numeric profile.
      const loc={line,col};
      let eol=i+2;
      while(eol<src.length&&!lineEnd(src[eol]))eol++;
      const tail=src.slice(i+2,eol).trimStart();
      if(tail.startsWith('oreslang:checked-i64'))
        throw new CompileError('checked-i64 source requires program-v2; scalar-v1 uses provisional wrapping arithmetic',loc);
      while(i<eol)advance();
      continue;
    }
    if(src.startsWith('/*',i)){
      const loc={line,col};advance();advance();let depth=1;
      while(depth&&i<src.length){
        if(src.startsWith('/*',i)){depth++;if(depth>64)throw new CompileError('comment nesting limit',loc);advance();advance();}
        else if(src.startsWith('*'+'/',i)){depth--;advance();advance();}
        else advance();
      }
      if(depth)throw new CompileError('unterminated comment',loc);
      continue;
    }
    const loc={line,col};
    if(/[A-Za-z_]/.test(src[i])){
      let s='';while(i<src.length&&/[A-Za-z0-9_]/.test(src[i])){s+=src[i];advance();}
      // A typed Topic receiver may be a local, parameter or import. Until
      // scalar ESM owns actor/group capabilities, share! and Result lowering,
      // reject actual member publication before producing source/IR artifacts.
      // Opaque strings/comments were already skipped by this lexer.
      if(s==='try_publish' && out.at(-1)?.kind==='sym' &&
         out.at(-1).value==='.')
        throw new CompileError(
          'Topic.try_publish requires checked actor/group, share! and Result lowering; JS scalar backend unsupported',loc);
      if (missingBangKeywordSeparator(s, src.slice(i)))
        throw new CompileError('E_BANG_KEYWORD_WHITESPACE: ASCII whitespace required after '+s+'!',loc);
      // Record the first contextual ownership bang so the typed Future
      // preflight can still diagnose its legacy and canonical spellings.
      if(['copy','take','move','borrow','share'].includes(s) && src[i]==='!' &&
          src[i+1]!=='=' &&
          !(src.slice(i+1,i+3)==='eq' && !/[A-Za-z0-9_]/.test(src[i+3]??'')))
        ownershipBang ??= loc;
      add('id',s,loc);
    }else if(/[0-9]/.test(src[i])){
      let s='';while(i<src.length&&/[0-9_]/.test(src[i])){s+=src[i];advance();}
      if(!/^[0-9]+(?:_[0-9]+)*$/.test(s))throw new CompileError('invalid integer literal',loc);
      if (s.length > 64) throw new CompileError('integer literal length limit',loc);
      add('int',s,loc);
    }else if(src[i]==="'" || src[i]==='"' || src[i]==='\x60'){
      // Keep a quoted literal or entire balanced backtick template opaque:
      // keywords, braces and comments inside it are not outer-source tokens.
      let literal;
      try { literal=scanStringLiteral(src,i); }
      catch(error) {
        if(error instanceof SyntaxError)throw new CompileError(error.message,loc);
        throw error;
      }
      while(i<literal.end)advance();
      add(literal.kind,literal,loc);
    }else if(src.startsWith('...',i)){add('sym','...',loc);advance();advance();advance();}
    else if(src.startsWith('->',i)||src.startsWith('::',i)||src.startsWith(':=',i)){add('sym',src.slice(i,i+2),loc);advance();advance();}
    else if(src[i]==='%')throw new CompileError("'%' is reserved and is not AttoLang source syntax; use Integer.rem(a, b) or Integer.mod(a, b)",loc);
    else if(src[i]==='^')throw new CompileError(src.startsWith('^^',i)?"'^^' is reserved and is not AttoLang source syntax; use Xor(a, b)":"'^' is reserved and is not AttoLang source syntax; use Integer.bitXor(a, b)",loc);
    else if('(){}[]:,;+-*/=.!<>'.includes(src[i])){add('sym',src[i],loc);advance();}
    else throw new CompileError('unsupported character',loc);
  }
  out.push({kind:'eof',value:'<eof>',line,col});
  return {tokens:out,ownershipBang};
}
function rejectUnloweredInvertedClasses(tokens) {
  for (let i=0; i+2<tokens.length; i++) {
    let at=i;
    if (tokens[at]?.value==='pub' && tokens[at+1]?.value==='define') at++;
    if (tokens[at]?.value!=='define') continue;
    at++;
    if (tokens[at]?.value==='pub') at++;
    if (tokens[at]?.value==='inverted' && tokens[at+1]?.value==='class')
      throw new CompileError(
        'inverted class requires checked bracket-row and ownership lowering in the JS backend',
        tokens[at]);
  }
}
// Singleton is a declaration-context keyword, not a global reserved identifier.
// This scalar JS emitter has no checked application-domain initialization, actor
// owner provenance or fair scoped RW loans; never silently emit host JS for one.
function rejectSingletonDeclarations(tokens) {
  for (let i=0;i<tokens.length;i++) {
    let at=i;
    if(tokens[at]?.value==='pub' && tokens[at+1]?.value==='define') at++;
    if(tokens[at]?.value!=='define') continue;
    at++;
    if(tokens[at]?.value==='pub') at++;
    if(tokens[at]?.kind==='id' && tokens[at].value==='singleton')
      throw new CompileError(
        'ORES-SINGLETON-UNSUPPORTED: singleton requires compiler-resolved application-domain identity, exactly-once frozen publication and guarded unique-owner RW lowering',
        tokens[at]);
  }
}
// The scalar JS emitter has no nominal actor/object layout or lifetime/borrow
// admission. Reject before building IR so a .atto actor heap can never
// accidentally produce scalar JS that looks like a successful guest compile.
// Inspect lexed tokens only: strings and comments are not authoritative code.
function rejectUnloweredActorHeap(tokens) {
  for (let i=0;i<tokens.length;i++) {
    const at=tokens[i];
    if(at.kind!=='id')continue;
    if(at.value==='new' && tokens[i+1]?.kind==='id' &&
       tokens[i+2]?.value==='(') {
      throw new CompileError(
        'E_ACTOR_MEMORY_GUEST_UNSUPPORTED: checked actor-owned class allocation and Ref32 field lowering are unavailable in JS scalar-v1',
        at);
    }
    if(at.value!=='define' && at.value!=='pub')continue;
    let p=i;
    if(tokens[p]?.value==='pub') p++;
    if(tokens[p]?.value!=='define') continue;
    p++;
    if(tokens[p]?.value==='pub') p++;
    if(tokens[p]?.value==='class' || tokens[p]?.value==='actor' ||
       (tokens[p]?.value==='inverted' && tokens[p+1]?.value==='class')) {
      // Keep the existing precise inverted-class diagnostic, which the
      // separate inversion gate owns. Do not reinterpret it as actor heap.
      if(tokens[p]?.value==='inverted')continue;
      throw new CompileError(
        'E_ACTOR_MEMORY_GUEST_UNSUPPORTED: JS scalar-v1 requires typed actor heap, nominal layout and ownership lowering',
        tokens[p]);
    }
  }
}

function rejectUnsupportedSelect(tokens) {
  const startsStaticSelect = next =>
    next && ['{','over','first','fair','random'].includes(next.value);
  for (let i=0;i<tokens.length;i++) {
    const token=tokens[i];
    if (token.kind === 'id' && token.value === 'select' &&
        startsStaticSelect(tokens[i+1])) {
      throw new CompileError(
        'static select requires checked Channel/Future arbitration, actor-lane continuation, ownership and cancellation lowering in the JS backend',
        token
      );
    }
  }
}
// Scalar aggregate lowering erases source names. Validate them before erasure
// using unconditional language keywords, not contextual identifiers.
const AGGREGATE_RESERVED_WORDS = new Set([
  'unsafe','sync','task','pipe','rpipe','define','def','module','namespace',
  'contract','conforms','class','struct','interface','trait','type','types',
  'typeof','abstract','extends','implements','impl','import','from','as',
  'using','fnc','routine','pure','async','suspends','generator','yield','nlex',
  'return','begin','self','super','static','pub','private','const','val','let',
  'mut','if','guard','then','else','elif','elseif','fi','do','done','end',
  'while','for','of','loop','block','break','continue','switch','match','maybe',
  'matches','over','default','try','catch','finally','throw','raise','panic',
  'recover','trap','defer','actor','persistent','durable','isoactor','shared',
  'untrusted','spawn','stop','rt','await','nb','cb','select','readch','writech',
  'eq','neq','is','new','true','false','null','void','obj','arr','cpu','gpu','quantum'
]);
class Parser {
  constructor(tokens){this.ts=tokens;this.pos=0;this.depth=0;}
  peek(){return this.ts[this.pos];}
  match(v){if(this.peek().value===v){this.pos++;return true;}return false;}
  expect(v){if(!this.match(v))throw new CompileError('expected '+v+', found '+this.peek().value,this.peek());}
  id(){const t=this.peek();if(t.kind!=='id')throw new CompileError('expected identifier',t);this.pos++;return t.value;}
  aggregateIdentifier(){
    const at=this.peek(), name=this.id();
    if(name.length>128 || AGGREGATE_RESERVED_WORDS.has(name) || name==='infer')
      throw new CompileError('E_TYPE_NAME: reserved or oversized aggregate identifier',at);
    return name;
  }
  // The scalar Record profile supports standard JSON-compatible double-quoted
  // keys; other legacy string escapes stay fail-closed until a shared decoder
  // is available. Never compare raw spellings or normalize decoded keys.
  readQuotedRecordKey(){
    const token=this.peek();
    if(token.kind!=='string'||token.value.quote!=='"')
      throw new CompileError('E_RECORD_LABEL: parenthesized Record requires double-quoted key',token);
    let key;
    try { key=JSON.parse(token.value.raw); }
    catch { throw new CompileError('E_RECORD_LABEL: unsupported quoted key escape in scalar profile',token); }
    if(key.length===0||key.length>128||/[\x00-\x1f\x7f-\x9f]/.test(key))
      throw new CompileError('E_RECORD_LABEL: empty, oversized or control-character key outside scalar profile',token);
    this.pos++;
    return key;
  }
  // Only compile-time scalar literals in local const bindings. No dynamic
  // evaluation, aggregate values or runtime reflection in this bootstrap path.
  readAggregateScalar(params, allowRuntime) {
    const token=this.peek();let type,value;
    if(token.kind==='int'||token.value==='-'){
      const negative=this.match('-'), number=this.peek();
      if(number.kind!=='int')throw new CompileError('E_TYPE_INFER_AMBIGUOUS: scalar integer required',number);
      this.pos++;
      value=BigInt(number.value.replaceAll('_',''))*(negative?-1n:1n);
      if(value<-(1n<<63n)||value>I64_MAX)throw new CompileError('aggregate int outside signed i64',number);
      type='int';
    }else if(token.kind==='id'&&['true','false'].includes(token.value)){
      this.pos++;type='bool';value=token.value==='true';
    }else if(token.kind==='string'){
      this.pos++;type='string';value=token.value;
    }else if(token.kind==='id'&&this.scalarConsts?.has(token.value)){
      this.pos++;return this.scalarConsts.get(token.value);
    }else if(allowRuntime&&token.kind==='id'&&params.includes(token.value)){
      this.pos++;type='int';value={kind:'var',name:token.value};
    }else throw new CompileError('E_TYPE_INFER_AMBIGUOUS: literal or immutable int parameter required',token);
    return {type,value};
  }
  // Bounded immutable literal-only tree. This is compile-time scalar
  // projection, not an escaping aggregate ABI or dynamic array lowering.
  readRecordValue(params,allowRuntime,depth=0){
    const at=this.peek();
    if(depth>=32)throw new CompileError('E_SOURCE_LIMIT: nested Record/Array depth',at);
    if(this.match('[')){
      const items=[];
      if(this.peek().value!==']')do{
        if(items.length>=64)throw new CompileError('E_SOURCE_LIMIT: array literal size',this.peek());
        items.push(this.readRecordValue([],false,depth+1));
        if(!this.match(','))break;
        if(this.peek().value===']')break;
      }while(true);
      this.expect(']');
      // No contextual empty-element inference in this profile. Preserve
      // exact scalar element type, or the finite set of Record shapes.
      if(!items.length)throw new CompileError('E_TYPE_INFER_AMBIGUOUS: empty Array requires element type',at);
      const allRecords=items.every(x=>x.type.startsWith('Record:'));
      const types=[...new Set(items.map(x=>x.type))].sort();
      if(types.length!==1&&!allRecords)
        throw new CompileError('E_TYPE_MISMATCH: incompatible Array elements',at);
      return {type:'Array:'+types.map(t=>t.length+':'+t).join(''),items};
    }
    if(this.peek().value==='{'||
       (this.peek().value==='('&&this.ts[this.pos+1]?.kind==='string'&&this.ts[this.pos+2]?.value===':')){
      const open=this.peek().value;this.pos++;
      const close=open==='{'?'}':')',fields=new Map();
      if(this.peek().value!==close)do{
        if(fields.size>=64)throw new CompileError('E_SOURCE_LIMIT: nested Record size',this.peek());
        const key=open==='('?this.readQuotedRecordKey():this.aggregateIdentifier();
        if(fields.has(key))throw new CompileError('E_DUPLICATE_FIELD: '+key,this.peek());
        this.expect(':');
        fields.set(key,this.readRecordValue([],false,depth+1));
        if(!this.match(','))break;
        if(this.peek().value===close)break;
      }while(true);
      this.expect(close);
      const slots=[...fields].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
      return {type:'Record:'+slots.map(([k,v])=>k.length+':'+k+v.type.length+':'+v.type).join(''),fields};
    }
    return this.readAggregateScalar(params,allowRuntime);
  }
  localConst(params){
    const at=this.peek(), next=this.ts[this.pos+1]?.value;
    if(['Record','Tuple','struct'].includes(next)){
      this.aggregateConst(params);return;
    }
    this.expect('const');
    const name=this.aggregateIdentifier();
    if(params.includes(name)||this.aggregateLocals.has(name)||this.scalarConsts.has(name))
      throw new CompileError('duplicate local binding '+name,at);
    if(this.aggregateLocals.size+this.scalarConsts.size>=64)
      throw new CompileError('aggregate binding limit',at);
    // Name-derived Pair binding is distinct from a Record field.
    if(this.match(':=')){
      this.readLocalPair(name,name,at);return;
    }
    this.expect('=');
    if(this.peek().kind==='id'&&this.ts[this.pos+1]?.value===':='){
      const key=this.aggregateIdentifier();this.expect(':=');this.readLocalPair(name,key,at);return;
    }
    if(this.peek().kind==='id'&&this.ts[this.pos+1]?.value==='with'){
      const base=this.readConstRecordOperand();
      this.expect('with');this.readAggregateFields('Record',name,null,false,params,at,false,base);return;
    }
    const open=this.peek().value;
    // Scalar grouping without a Tuple expectation is still scalar.
    // Recognize only the complete existing constexpr scalar leaf grammar;
    // never speculate, consume a field label, or flatten a nested product.
    if(open==='('){
      const leaf=this.ts[this.pos+1], negative=leaf?.value==='-'&&leaf.kind!=='string';
      const scalar=negative?this.ts[this.pos+2]:leaf;
      const close=this.ts[this.pos+(negative?3:2)];
      const end=this.ts[this.pos+(negative?4:3)];
      const admitted=scalar&&(scalar.kind==='int'||(!negative&&
        (scalar.kind==='string'||(scalar.kind==='id'&&
          (['true','false'].includes(scalar.value)||this.scalarConsts.has(scalar.value))))));
      if(admitted&&close?.kind!=='string'&&close?.value===')'&&end?.value===';'){
        this.expect('(');const value=this.readAggregateScalar([],false);
        this.expect(')');this.expect(';');this.scalarConsts.set(name,value);return;
      }
    }
    if(open==='{'||open==='('||open==='struct'){
      // Without a concrete expected kind, the zero-arity () literal
      // defaults to Tuple. Nonempty inferred positional tuples remain
      // outside this bounded local scalar profile.
      const kind=open==='struct'?'struct':open==='('&&this.ts[this.pos+1]?.value===')'?'Tuple':'Record';
      if(kind==='struct')this.pos++;
      this.readAggregateFields(kind,name,null,false,params,at,false);
    }else{
      const value=this.readAggregateScalar([],false);
      this.expect(';');this.scalarConsts.set(name,value);
    }
  }
  readLocalPair(name,key,at){
    // The scalar subset exposes only integer .value projection. Preserve
    // the literal key and nominal kind; do not resolve it as a variable.
    const field=this.readAggregateScalar([],false);
    this.expect(';');
    this.aggregateLocals.set(name,{kind:'Pair',key,fields:new Map([['value',field]])});
  }
  readConstRecordOperand(){
    const at=this.peek(),name=this.aggregateIdentifier();
    const record=this.aggregateLocals.get(name);
    if(record?.kind!=='Record'||[...record.fields.values()].some(f=>f.type==='int'&&typeof f.value!=='bigint'))
      throw new CompileError('E_RECORD_SPREAD: requires an initialized compile-time scalar Record',at);
    return record;
  }
  // Restricted scalar aggregate profile: immutable literals and direct int
  // parameter reads only. No aggregate ABI, escaping values or effectful inference.
  aggregateConst(params){
    const at=this.peek();this.expect('const');
    const kind=this.id();
    let alias=null, binder=false;
    if(this.match('<')){
      binder=this.match('infer');
      alias=this.aggregateIdentifier(); // bare infer cannot consume the closing angle
      if(['infer','Record','Tuple','struct','int','bool','string','const','let','val',
          'fnc','return','true','false','void','null','self','float','decimal','bigint','uint',
          'i8','i16','i32','i64','u8','u16','u32','u64','f32','f64','String','Bool','Integer',
          'boolean','Any','Unknown','Object','Error','Symbol','Array','List','Vector','Slice',
          'FixedArray','FixedList','Map','OrderedMap','Set','Pair','Entry','Option','Result',
          'Future','Channel','ActorId','ActorKind','ActorRef','Mutex','MutexGuard','SharedMutex',
          'Generator','AsyncGenerator','Iterator','AsyncIterator','Fnc','Function','define',
          'Pointer','ActorMail','ReadLoan','WriteLoan','Atomic','AtomicRef','AtomicBool','AtomicInt',
          'AtomicLong','AtomicI8','AtomicI16','AtomicI32','AtomicI64','AtomicU8','AtomicU16',
          'AtomicU32','AtomicU64','Arc','Weak','Box','Rc','RwLock','RwLockReadGuard',
          'RwLockWriteGuard','UnsafeCell',
          'type','module','class','actor','pub','new','if','else','end','routine'].includes(alias))
        throw new CompileError('E_TYPE_NAME: reserved type name',at);
      this.expect('>');
      if(binder&&this.aggregateTypes.has(alias))
        throw new CompileError('E_DUPLICATE_TYPE: '+alias,at);
      // Unknown aliases are resolved only after inspecting explicit infer.
    }
    const name=this.aggregateIdentifier();
    if(params.includes(name)||this.aggregateLocals.has(name))
      throw new CompileError('duplicate aggregate binding '+name,at);
    if(this.aggregateLocals.size+(this.scalarConsts?.size??0)>=64)
      throw new CompileError('aggregate binding limit',at);
    if(this.scalarConsts?.has(name))
      throw new CompileError('duplicate local binding '+name,at);
    this.expect('=');
    const infer=this.match('infer');
    if(infer){
      if(kind!=='Record'||alias===null||binder||!this.scalarConsts)
        throw new CompileError('E_TYPE_INFER_AMBIGUOUS: infer requires local Record<T>',at);
      if(!this.aggregateTypes.has(alias)){
        if(params.includes(alias)||this.aggregateLocals.has(alias)||this.scalarConsts.has(alias)||alias===name)
          throw new CompileError('E_DUPLICATE_TYPE: '+alias,at);
        binder=true;
      }
    }
    if(alias!==null&&!binder&&!this.aggregateTypes.has(alias))
      throw new CompileError('E_UNKNOWN_TYPE: '+alias,at);
    let base=null;
    if(kind==='Record'&&this.peek().kind==='id'&&this.ts[this.pos+1]?.value==='with'){
      base=this.readConstRecordOperand();this.expect('with');
    }
    this.readAggregateFields(kind,name,alias,binder,params,at,true,base);
  }
  readAggregateFields(kind,name,alias,binder,params,at,allowRuntime,base=null){
    const open=this.peek().value;
    if(kind==='struct')this.expect('{');
    else if(kind==='Record'&&(open==='{'||open==='('))this.pos++;
    else this.expect('(');
    const close=open==='{'?'}':')', fields=new Map(base?.fields), explicit=new Set(), spreadConflicts=new Set();
    let ordinaryField=false,entryCount=0;
    if(base&&open!=='{')throw new CompileError('E_RECORD_SPREAD: with requires braces',at);
    if(this.peek().value===close&&(kind==='struct'||base||(kind==='Record'&&open==='{'&&!allowRuntime)))
      throw new CompileError('E_LITERAL_KIND: empty braces require explicit Record in this profile',at);
    // An explicitly typed zero-slot Record or Tuple shares this literal
    // syntax, not its kind. Preserve the kind through shape matching.
    if(this.peek().value!==close) do {
      if(++entryCount>64)throw new CompileError('aggregate entry limit',this.peek());
      if(kind==='Record'&&open==='{'&&this.match('...')){
        const source=this.readConstRecordOperand();
        for(const [key,field] of source.fields){
          if(explicit.has(key))throw new CompileError('E_RECORD_SPREAD: spread overrides explicit field '+key,this.peek());
          if(fields.has(key))spreadConflicts.add(key);
          fields.set(key,field);
          if(fields.size>64)throw new CompileError('aggregate field limit',this.peek());
        }
        if(!this.match(','))break;
        if(this.peek().value===close)break;
        continue;
      }
      if(explicit.size>=64)throw new CompileError('aggregate field limit',this.peek());
      const capture=kind!=='Tuple'&&this.match(':');
      if(kind==='Record'&&open==='{'&&!capture&&this.peek().kind!=='id')
        throw new CompileError('E_RECORD_LABEL: brace Record requires identifier key',this.peek());
      const key=kind==='Tuple'?String(fields.size):
        kind==='Record'&&open==='('&&!capture?this.readQuotedRecordKey():this.aggregateIdentifier();
      if(explicit.has(key))throw new CompileError('E_DUPLICATE_FIELD: '+key,this.peek());
      explicit.add(key);spreadConflicts.delete(key);
      let field,pairEntry=false;
      if(capture){
        ordinaryField=true;
        // Capture only already resolved compile-time scalar bindings. A
        // parameter is not a compile-time constant; do not invent its value.
        field=this.scalarConsts?.get(key);
        if(!field)throw new CompileError('E_TYPE_INFER_AMBIGUOUS: capture needs a local const scalar',this.peek());
      }else{
        // Colon is the specified quoted-key parenthesized spelling.
        // Quoted = and := are unresolved; do not promote them implicitly.
        // Retain brace punctuation and independent capture/Struct/Tuple paths.
        if(kind==='Record'){
          if(open==='('){this.expect(':');ordinaryField=true;}
          else if(this.match(':='))pairEntry=true;
          else {if(!this.match(':'))this.expect('=');ordinaryField=true;}
        }else if(kind==='struct')this.expect(':');
        field=kind==='Record'?this.readRecordValue(params,allowRuntime):this.readAggregateScalar(params,allowRuntime);
      }
      fields.set(key,field);
      if(fields.size>64)throw new CompileError('aggregate field limit',this.peek());
      const comma=this.match(',');
      if(!comma){
        // Only a complete inline Pair entry may use a newline separator.
        if(open==='{'&&pairEntry&&this.peek().kind==='id'&&this.peek().line>this.ts[this.pos-1].endLine)continue;
        break;
      }
      if(this.peek().value===close)break;
    } while(true);
    this.expect(close);this.expect(';');
    if(kind==='Record'&&open==='('&&entryCount!==0&&!ordinaryField)throw new CompileError('E_LITERAL_KIND: Pair-only parentheses are not a Record',at);
    if(spreadConflicts.size)throw new CompileError('E_RECORD_SPREAD: unresolved spread overlap',at);
    const shape={kind,fields:new Map([...fields].map(([k,v])=>[k,v.type]))};
    if(alias!==null&&!binder){
      const expected=this.aggregateTypes.get(alias);
      if(expected.kind!==kind)throw new CompileError('E_AGGREGATE_KIND: '+alias,at);
      if(expected.fields.size!==shape.fields.size||
          [...expected.fields].some(([k,v])=>shape.fields.get(k)!==v))
        throw new CompileError('E_TYPE_MISMATCH: '+alias,at);
    }
    if(binder)this.aggregateTypes.set(alias,shape);
    this.aggregateLocals.set(name,{kind,fields});
  }
  aggregateProjection(){
    const at=this.peek(), aggregate=this.aggregateLocals.get(at.value);
    this.pos++;
    let key;
    if(aggregate.kind==='Tuple'){
      this.expect('[');
      const index=this.peek();
      if(index.kind!=='int'||!/^(0|[1-9][0-9]*)$/.test(index.value))
        throw new CompileError('tuple projection requires a static index',index);
      key=index.value;this.pos++;this.expect(']');
    }else if(aggregate.kind==='Record'&&this.match('[')){
      key=this.readQuotedRecordKey();this.expect(']');
    }else{
      this.expect('.');key=this.aggregateIdentifier();
    }
    let field=aggregate.fields.get(key);
    if(!field)throw new CompileError('E_NO_FIELD: '+key,at);
    while(this.peek().value==='.'||this.peek().value==='['){
      const where=this.peek();
      if(field.items){
        this.expect('[');
        const index=this.peek();
        if(index.kind!=='int'||!/^(0|[1-9][0-9]*)$/.test(index.value))
          throw new CompileError('E_ARRAY_INDEX: static nonnegative integer required',index);
        this.pos++;this.expect(']');
        if(BigInt(index.value)>=BigInt(field.items.length))
          throw new CompileError('E_ARRAY_BOUNDS: index outside literal array',index);
        field=field.items[Number(index.value)];
      }else if(field.fields){
        let member;
        if(this.match('[')){member=this.readQuotedRecordKey();this.expect(']');}
        else {this.expect('.');member=this.aggregateIdentifier();}
        field=field.fields.get(member);
        if(!field)throw new CompileError('E_NO_FIELD: '+member,where);
      }else throw new CompileError('E_TYPE_MISMATCH: scalar cannot be projected',where);
    }
    if(field.type!=='int')throw new CompileError('JS scalar aggregate profile supports only int projections',at);
    return typeof field.value==='bigint' ? {kind:'int',n:field.value} : {...field.value};
  }
  exportDeclaration(){
    this.expect('export');this.expect('pub');
    let visibility='public';
    if(this.match('[')){this.expect('pkg');this.expect(']');visibility='package';}
    let kind=null;
    if(this.match('class'))kind='class';
    else if(this.match('fnc'))kind='fnc';
    const name=this.id();this.expect(';');
    return {name,kind,visibility};
  }
  parse(){
    const module=this.peek().value==='define' && this.ts[this.pos+1]?.value==='module';
    if(module){this.pos++;this.expect('module');this.id();this.match('as');}
    const functions=[],exports=[];
    // Module prefix: named immutable literal Record/Tuple exemplars.
    // No module struct identity or full aggregate ABI is admitted.
    this.aggregateTypes=new Map();this.aggregateLocals=new Map();
    while(this.peek().value==='const'&&['Record','Tuple','struct'].includes(this.ts[this.pos+1]?.value)){
      if(this.ts[this.pos+1].value==='struct'||this.ts[this.pos+2]?.value!=='<')
        throw new CompileError('E_MODULE_AGGREGATE_INFER_UNSUPPORTED: expected named Record or Tuple',this.peek());
      this.aggregateConst([]);
    }
    const moduleTypes=this.aggregateTypes,moduleLocals=this.aggregateLocals;
    while(this.peek().kind!=='eof'&&!(module&&this.peek().value==='end')){
      if(this.peek().value==='export'){
        if(exports.length>=1024)throw new CompileError('file export budget',this.peek());
        exports.push(this.exportDeclaration());continue;
      }
      if(functions.length>=512)throw new CompileError('function limit',this.peek());
      // Accept only one define and one pub, in either canonical order.
      // Deliberately do not admit pub define module in this scalar subset.
      let pub=this.match('pub');
      if(pub){this.match('define');}
      else if(this.match('define')){pub=this.match('pub');}
      const at=this.peek();
      if(!this.match('fnc')&&!this.match('routine'))throw new CompileError('unsupported declaration',at);
      const name=this.id();
      if(moduleLocals.has(name))throw new CompileError('duplicate module binding '+name,at);
      this.expect('(');const params=[];
      if(!this.match(')')){
        do{if(params.length>=128)throw new CompileError('parameter limit');this.expect('int');const v=this.id();if(params.includes(v))throw new CompileError('duplicate parameter '+v);params.push(v);}while(this.match(','));
        this.expect(')');
      }
      // The bootstrap parser only supports int functions with a single
      // return expression. Support canonical arrow/end spellings without
      // pretending to support arbitrary statement bodies or async functions.
      const arrow=this.match('->');
      if(!arrow)this.expect(':');
      this.expect('int');
      const braced=this.match('{');
      if(!braced&&!arrow)throw new CompileError('expected { for colon function body',this.peek());
      if(!braced){if(!this.match('as'))this.match('::');}
      this.aggregateTypes=new Map(moduleTypes);this.aggregateLocals=new Map(moduleLocals);
      for(const param of params)this.aggregateLocals.delete(param);
      this.scalarConsts=new Map();
      while(this.peek().value==='const')this.localConst(params);
      this.expect('return');
      const body=startsBareSequence(this)
        ? (this.pos++,this.sequence(false)) : this.expr();
      this.expect(';');this.expect(braced?'}':'end');
      functions.push({name,params,body,pub});
    }
    if(module)this.expect('end');
    if(this.peek().kind!=='eof')throw new CompileError('trailing tokens',this.peek());
    if(!functions.length)throw new CompileError('no functions');
    const seen=new Set();
    for(const entry of exports){
      if(seen.has(entry.name))throw new CompileError('duplicate export '+entry.name);
      seen.add(entry.name);
      if(entry.kind!==null&&entry.kind!=='fnc')
        throw new CompileError('export kind mismatch '+entry.name);
      const family=functions.filter(f=>f.name===entry.name);
      if(!family.length)throw new CompileError('unbound export '+entry.name);
      if(entry.visibility==='package'&&family.some(f=>f.pub))
        throw new CompileError('package export conflicts with public declaration '+entry.name);
      if(entry.visibility==='public')family.forEach(f=>{f.pub=true;});
    }
    return functions;
  }
  expr(min=0){
    if(++this.depth>256)throw new CompileError('expression nesting limit',this.peek());
    try{
      let left=this.primary();
      while(true){
        const op=this.peek().value;
        if(op==='/')throw new CompileError('unsupported operator '+op,this.peek());
        const prec=op==='*'?20:op==='+'||op==='-'?10:-1;
        if(prec<min)break;
        this.pos++;left={kind:'binary',op,left,right:this.expr(prec+1)};
      }
      return left;
    }finally{this.depth--;}
  }
  sequence(parenthesized){
    return readSequence(this,parenthesized,(message,at)=>{throw new CompileError(message,at);});
  }
  callArguments(){
    return readCallArguments(this,(message,at)=>{throw new CompileError(message,at);});
  }
  primary(){
    const t=this.peek();
    if(t.kind==='id'&&t.value==='seq'&&this.ts[this.pos+1]?.value==='('){
      this.pos+=2;
      return this.sequence(true);
    }
    if(this.match('-')){
      // The absolute magnitude 2^63 is legal only as a negated literal.
      // All other positive literals must remain within signed i64.
      const next=this.peek();
      if(next.kind==='int' && BigInt(next.value.replaceAll('_',''))===(1n<<63n)){
        this.pos++;return {kind:'int',n:-(1n<<63n)};
      }
      return {kind:'neg',inner:this.expr(30)};
    }
    if(this.match('+'))return this.expr(30);
    if(this.match('(')){
      if(this.match('>'))return this.sequence(true);
      const v=this.expr();this.expect(')');return v;
    }
    if(t.kind==='int'){this.pos++;const n=BigInt(t.value.replaceAll('_',''));if(n>I64_MAX)throw new CompileError('positive int outside signed i64',t);return {kind:'int',n};}
    if(t.kind==='string'||t.kind==='template')
      throw new CompileError('quoted strings and template interpolation require typed String lowering; unsupported in JS scalar-v1',t);
    if(t.kind==='id' && t.value==='rt'){
      this.pos++;
      const op=this.peek();
      if(op.kind!=='id')throw new CompileError('expected runtime operation after rt',op);
      if(['ref','unref','deref','raw'].includes(op.value))
        throw new CompileError('pointer-style runtime operation rt '+op.value+' is not valid Oreslang source',op);
      if(op.value==='mut' && this.ts[this.pos+1]?.value!=='borrow')
        throw new CompileError("'rt mut' only supports borrowing; use 'rt mut borrow value'",op);
      throw new CompileError('runtime ownership operation requires typed lowering in the JS scalar backend',op);
    }
    if(t.kind==='id'&&t.value==='Integer'&&this.ts[this.pos+1]?.value==='.'){
      // Named integer operations replace the reserved %, ^ and ^^ operators.
      this.pos+=2;
      const name=this.peek();
      const ops={rem:'%',mod:'mod',bitXor:'^'};
      if(name.kind!=='id'||!Object.hasOwn(ops,name.value))throw new CompileError('Integer.'+name.value+' is unsupported; use Integer.rem, Integer.mod or Integer.bitXor',name);
      this.pos++;this.expect('(');const args=this.callArguments();
      if(args.length!==2)throw new CompileError('Integer.'+name.value+' requires two arguments',name);
      return {kind:'binary',op:ops[name.value],left:args[0],right:args[1]};
    }
    if(t.kind==='id'&&this.scalarConsts?.has(t.value)){
      const scalar=this.scalarConsts.get(t.value);this.pos++;
      if(scalar.type!=='int')throw new CompileError('JS scalar profile supports only int reads',t);
      return {kind:'int',n:scalar.value};
    }
    if(t.kind==='id'&&this.aggregateLocals?.has(t.value))
      return this.aggregateProjection();
    if(t.kind==='id'){
      this.pos++;
      if(this.match('(')){
        return {kind:'call',name:t.value,args:this.callArguments()};
      }
      return {kind:'var',name:t.value};
    }
    throw new CompileError('unexpected '+t.value,t);
  }
}
// The isolated parser is a bootstrap adapter. Future language frontends
// should produce this versioned IR instead of duplicating parser semantics.
export function compileToIR(source) {
  const {tokens,ownershipBang}=lex(source);
  // Reject affine Future violations at the compiler core boundary before IR.
  // Valid Future code still cannot execute in the scalar-only JS backend.
  preflightCoreFutureOwnership(tokens,(code,message,token)=>{throw new CompileError(code+': '+message,token);});
  if(ownershipBang)
    throw new CompileError('OWNERSHIP_BANG_BACKEND_UNSUPPORTED: checked JS ownership lowering required',ownershipBang);
  rejectExecutionDomains(tokens,(message,token)=>{throw new CompileError(message,token);});
  rejectUnsupportedHttpActors(tokens,(message,token)=>{throw new CompileError(message,token);});
  rejectSingletonDeclarations(tokens);
  rejectUnloweredInvertedClasses(tokens);
  rejectUnloweredActorHeap(tokens);
  rejectUnsupportedSelect(tokens);
  const parsed=new Parser(tokens).parse();
  try {
    return createScalarIR(parsed);
  } catch (error) {
    // Keep the source frontend's stable diagnostics while preserving
    // strict "scalar IR" diagnostics for direct compileIR callers.
    if(error?.name==='ScalarIRError' && typeof error.message==='string' &&
       error.message.startsWith('error: scalar IR: ')) {
      throw new CompileError(error.message.slice('error: scalar IR: '.length));
    }
    throw error;
  }
}
export function compileIR(input) {
  const ir = validateScalarIR(input);
  const fns = ir.functions;
  function lower(e, depth = 0) {
    if (depth > 384) throw new CompileError('expression depth limit during lowering');
    if (e.kind === 'int') return e.value + 'n';
    if (e.kind === 'param') return '_p' + e.index;
    if (e.kind === 'neg') return 'BigInt.asIntN(64,-(' + lower(e.inner, depth+1) + '))';
    if (e.kind === 'binary') {
      // Inline so programs without Integer.mod keep byte-identical output.
      if (e.op === 'mod')
        return '((a,b)=>{if(b===0n)throw new RangeError("ORES_I64_DIVISION_BY_ZERO: checked signed 64-bit remainder by zero");const r=a%b;return r<0n?BigInt.asIntN(64,b>0n?r+b:r-b):r;})(' +
          lower(e.left, depth+1) + ',' + lower(e.right, depth+1) + ')';
      return 'BigInt.asIntN(64,(' + lower(e.left, depth+1) + ')' + e.op + '(' +
        lower(e.right, depth+1) + '))';
    }
    if (e.kind === 'seq') {
      return '(' + e.items.map(item => lower(item, depth+1)).join(',') + ')';
    }
    if (e.kind === 'call') {
      return '_f' + e.target + '(' + e.args.map(arg => lower(arg, depth+1)).join(',') + ')';
    }
    throw new CompileError('invalid IR expression');
  }
  const out = [
    '// Oreslang JS scalar subset. Signed i64 wrapping is PROVISIONAL, not proven Java parity.',
    'function _int(v){if(typeof v!=="bigint"||v<-(1n<<63n)||v>(1n<<63n)-1n)throw new TypeError("Oreslang int requires a signed i64 BigInt");return v;}',
  ];
  fns.forEach((f,i) => {
    const params = f.params.map((_,j) => '_p' + j);
    out.push('function _f' + i + '(' + params.join(',') + '){');
    params.forEach(p => out.push('_int(' + p + ');'));
    out.push('return ' + lower(f.body) + ';', '}');
  });
  // String-literal export names prevent ECMAScript keyword collisions.
  fns.forEach((f,i) => {
    if (f.pub) out.push('export { _f' + i + ' as ' + JSON.stringify(f.name) + ' };');
  });
  return out.join('\n') + '\n';
}
export function compile(source) {
  return compileIR(compileToIR(source));
}
export function check(source) {
  compile(source);
  return true;
}
