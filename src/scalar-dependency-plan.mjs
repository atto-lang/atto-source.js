// Canonical direct dependency slots. Package IDs are caller-authorized logical
// identities, not a registry resolution or signature/provenance mechanism.
import {createHash} from 'node:crypto';
import {scalarInterface} from './scalar-package-interface.mjs';
const ID=/^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$/;
const NAME=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SHA=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('E_SCALAR_DEPENDENCY: '+m);};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
export const hashText=s=>createHash('sha256').update(s,'utf8').digest('hex');
export function canonicalDependencyPlan(input){
  if(!Array.isArray(input)||input.length<1||input.length>32)fail('dependency count');
  const ids=new Set(),aliases=new Set();
  const dependencies=input.map(d=>{
    if(!d||Object.keys(d).sort().join(',')!=='imports,interfaceSha256,packageId'||
       typeof d.packageId!=='string'||!ID.test(d.packageId)||d.packageId.split('/').some(p=>!p||p==='.'||p==='..')||
       typeof d.interfaceSha256!=='string'||!SHA.test(d.interfaceSha256)||ids.has(d.packageId)||
       !Array.isArray(d.imports)||!d.imports.length||d.imports.length>128)fail('invalid or duplicate dependency');
    ids.add(d.packageId);
    const imports=d.imports.map(i=>{
      if(!i||Object.keys(i).sort().join(',')!=='alias,exportName,params'||
         typeof i.alias!=='string'||!NAME.test(i.alias)||aliases.has(i.alias)||aliases.size>=128||
         typeof i.exportName!=='string'||!NAME.test(i.exportName)||
         !Array.isArray(i.params))fail('invalid or ambiguous import');
      aliases.add(i.alias);
      const entry=scalarInterface([{name:i.exportName,params:i.params,resultType:'int'}],'edge-js').entries[0];
      return {alias:i.alias,exportName:entry.name,params:entry.params};
    }).sort((a,b)=>cmp(a.alias,b.alias));
    return {packageId:d.packageId,interfaceSha256:d.interfaceSha256,imports};
  }).sort((a,b)=>cmp(a.packageId,b.packageId));
  const canonical=JSON.stringify({schema:'atto-js-direct-dependencies-v1',target:'edge-js',dependencies});
  if(Buffer.byteLength(canonical,'utf8')>65536)fail('dependency plan too large');
  return {dependencies,sha256:hashText(canonical)};
}
export function verifyDependencyInterface(dependency,entries){
  const abi=scalarInterface(entries,'edge-js');
  if(abi.sha256!==dependency.interfaceSha256)fail('provider ABI mismatch');
  for(const i of dependency.imports){
    const e=abi.entries.find(e=>e.name===i.exportName);
    if(!e||JSON.stringify(e.params)!==JSON.stringify(i.params))fail('provider import signature mismatch');
  }
}
