// Scalar package interface contract. This is NOT a general Atto package ABI.
import {createHash} from 'node:crypto';
import {HOST_ABI} from './host-bridge.mjs';
const NAME=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export function validatePublicNames(names) {
  if(!Array.isArray(names)||names.length>128||
     names.some(n=>typeof n!=='string'||!NAME.test(n)||n==='init'||n==='then')||
     new Set(names).size!==names.length)
    throw Error('unsupported public entrypoint (init and then are reserved at the package boundary)');
}
export function scalarInterface(entries,target) {
  if(!['browser','edge-js'].includes(target)||!Array.isArray(entries)) throw Error('invalid scalar interface');
  validatePublicNames(entries.map(e=>e.name));
  const sorted=entries.map(e=>{
    if(!e||typeof e!=='object'||Object.keys(e).sort().join(',')!=='name,params,resultType'||
       !Array.isArray(e.params)||e.params.length>128||
       e.params.some(p=>typeof p!=='string'||!NAME.test(p))||
       new Set(e.params).size!==e.params.length||e.resultType!=='int')
      throw Error('invalid scalar signature');
    return {name:e.name,params:[...e.params],resultType:'int'};
  }).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  const canonical=JSON.stringify({schema:'atto-js-scalar-interface-v2',target,hostABI:HOST_ABI,
    integerModel:'signed-i64-wrap-provisional',entries:sorted});
  return {entries:sorted,sha256:createHash('sha256').update(canonical).digest('hex')};
}
