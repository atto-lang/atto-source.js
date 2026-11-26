// Experimental Node trusted-host adapter: exact v2 fixture manifest subset,
// one pinned package and one selected namespace, public literal providers.
// This is not the general Atto parser/linker or persistent artifact store.
import {createHash} from 'node:crypto';
import {compile} from './compiler.mjs';

const deny=(s)=>{throw Error('E_NAMESPACE_PROFILE: '+s)};
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const name='[A-Za-z_][A-Za-z0-9_]{0,127}';
const namespace=name+'(?:\\.'+name+')*';
const header='schema_version = "2"\\n\\[project\\]\\nroot = "\\."\\n';
const pathRe=/^src\/[A-Za-z0-9_-]{1,120}\.(?:ores|atto)$/;
function bounded(s,limit){
  if(typeof s!=='string'||s.length>limit||!s.isWellFormed()||Buffer.byteLength(s)>limit||s.includes('\0'))deny('source budget');
  return s;
}
function exactMatch(re,s){const m=re.exec(s);if(!m||m[0]!==s)deny('unsupported syntax');return m;}
function providerManifest(s){
  bounded(s,65536);
  const m=exactMatch(new RegExp('^'+header+'\\[packages\\.('+name+')\\]\\nfiles = \\[([\\s\\S]*)\\]\\n$'),s);
  const raw=m[2].trim().replace(/,$/,'');
  const files=raw.split(',').map(x=>exactMatch(/^"([^"]+)"$/,x.trim())[1]);
  if(files.length<1||files.length>128||new Set(files).size!==files.length||files.some(x=>!pathRe.test(x)))deny('inventory paths');
  return {packageName:m[1],files:files.sort()};
}
function consumerManifest(s){
  bounded(s,65536);
  const m=exactMatch(new RegExp('^'+header+'\\[packages\\.('+name+')\\]\\nfiles = \\["src/main\\.ores"\\]\\n\\[namespace_dependencies\\.('+name+')\\]\\nmanifest = "\\.\\./('+name+')/\\.ores\\.pkg\\.toml"\\npackage = "('+name+')"\\nmanifest_sha256 = "([a-f0-9]{64})"\\nsources_sha256 = "([a-f0-9]{64})"\\n$'),s);
  if(m[3]!==m[4])deny('manifest locator');
  return {consumer:m[1],alias:m[2],packageName:m[4],manifestPin:m[5],sourcesPin:m[6]};
}
function classify(source){
  const m=exactMatch(new RegExp('^(?:namespace ('+namespace+');\\n)?(pub fnc ('+name+')\\(([^\\n()]*)\\): int \\{ return ([^\\n{};]+); \\})\\n$'),source);
  if(m[4]!=='')throw Error('E_NAMESPACE_ARITY: zero-argument provider required');
  if(!/^-?(?:0|[1-9][0-9]{0,18})$/.test(m[5]))deny('integer literal provider required');
  return {namespace:m[1]??null,declaration:m[2],symbol:m[3]};
}
function consumerSource(source){
  bounded(source,65536);
  const m=exactMatch(new RegExp('^namespace '+namespace+';\\nimport namespace ('+namespace+') as ('+name+') from "('+name+')";\\npub fnc main\\(\\): void \\{\\n([\\s\\S]*)  return;\\n\\}\\n$'),source);
  const calls=m[4].split('\n');
  if(calls.pop()!==''||!calls.length||calls.length>128)deny('consumer calls');
  const symbols=calls.map(line=>{
    const x=exactMatch(new RegExp('^  stdio\\.println\\(('+name+')\\.('+name+')\\(\\)\\);$'),line);
    if(x[1]!==m[2])deny('foreign alias');
    return x[2];
  });
  return {namespace:m[1],alias:m[3],symbols};
}
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');

export class PinnedScalarNamespaceEsmSession {
  #prior=new Map();#domain=null;#linked=null;
  build({consumer,consumerManifest:cm,providerManifest:pm,sources}={}){
    const dep=consumerManifest(cm),pkg=providerManifest(pm),selector=consumerSource(consumer);
    if(dep.alias!==selector.alias||dep.packageName!==pkg.packageName||sha(pm)!==dep.manifestPin)deny('manifest pin or identity mismatch');
    if(!(sources instanceof Map)||sources.size!==pkg.files.length)deny('inventory size');
    const snapshot=new Map();let total=0;
    for(const p of pkg.files){
      const source=bounded(sources.get(p),65536);total+=Buffer.byteLength(source);
      if(total>4*1024*1024)deny('inventory budget');
      snapshot.set(p,source);
    }
    const inventory=[...snapshot].map(([p,s])=>p+'\n'+sha(s)+'\n').join('');
    if(sha(inventory)!==dep.sourcesPin)deny('source pin mismatch');
    // Manifest identity excludes source body pin so a repinned body edit
    // retains domain. Include consumer identity and namespace selection.
    const domain=sha(JSON.stringify([dep.consumer,dep.alias,dep.manifestPin,selector.namespace]));
    const prior=domain===this.#domain?this.#prior:new Map(),next=new Map(),exports=new Map();
    let classified=0,classificationReused=0,compiled=0,artifactReused=0;
    for(const [p,source] of snapshot){
      let entry=prior.get(p);
      if(entry?.source===source)classificationReused++;
      else {entry={source,info:classify(source),code:null};classified++;}
      if(entry.info.namespace===selector.namespace){
        if(exports.has(entry.info.symbol))deny('duplicate selected symbol');
        // Actual Atto scalar compiler, not a host evaluator. Stage output
        // before updating any memo; failed validation cannot publish it.
        if(entry.code===null){entry={...entry,code:compile(entry.info.declaration)};compiled++;}
        else artifactReused++;
        exports.set(entry.info.symbol,entry.code);
      }
      next.set(p,entry);
    }
    const imports=[],calls=[],aliases=new Map();
    for(const symbol of selector.symbols){
      if(!exports.has(symbol))throw Error('E_NAMESPACE_SYMBOL: unavailable selected public symbol '+symbol);
      if(!aliases.has(symbol)){
        const local='_provider'+aliases.size;aliases.set(symbol,local);
        imports.push('import * as '+local+' from '+JSON.stringify(data(exports.get(symbol)))+';');
      }
      calls.push(aliases.get(symbol)+'['+JSON.stringify(symbol)+']()');
    }
    // Host-generated narrow adapter returns the observed values, not stdout.
    // No provider literal is evaluated by the adapter itself.
    const code=imports.join('\n')+'\nexport function main(){return ['+calls.join(',')+'];}\n';
    const relinked=domain===this.#domain&&code===this.#linked?0:1;
    this.#domain=domain;this.#prior=next;this.#linked=code;
    return {code,classified,classificationReused,compiled,artifactReused,relinked,domain};
  }
}
