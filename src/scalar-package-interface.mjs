// Scalar package interface contract. This is NOT a general Atto package ABI.
import {createHash} from 'node:crypto';
import {HOST_ABI} from './host-bridge.mjs';
const NAME=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
// JSON wire arrays cannot have holes. Reject sparse/accessor arrays before
// canonicalization, including direct compiler API callers. Snapshot plain
// own data values once so hash and returned interface describe the same bytes.
function denseArray(input,max,label) {
  if(!Array.isArray(input)||input.length>max)throw Error(label);
  const result=[];
  for(let i=0;i<input.length;i++){
    const d=Object.getOwnPropertyDescriptor(input,String(i));
    if(!d||!Object.hasOwn(d,'value'))throw Error(label);
    result.push(d.value);
  }
  return result;
}
export function validatePublicNames(names) {
  names=denseArray(names,128,'unsupported public entrypoint count');
  if(names.some(n=>typeof n!=='string'||!NAME.test(n)||n==='init'||n==='then')||
     new Set(names).size!==names.length)
    throw Error('unsupported public entrypoint (init and then are reserved at the package boundary)');
}
export function scalarInterface(entries,target) {
  if(!['browser','edge-js'].includes(target)||!Array.isArray(entries)||entries.length>128) throw Error('invalid scalar interface');
  entries=denseArray(entries,128,'invalid scalar interface');
  const sorted=entries.map(e=>{
    if(!e||typeof e!=='object'||Object.keys(e).sort().join(',')!=='name,params,resultType')
      throw Error('invalid scalar signature');
    const fields=['name','params','resultType'].map(k=>Object.getOwnPropertyDescriptor(e,k));
    if(fields.some(d=>!d||!Object.hasOwn(d,'value')))throw Error('invalid scalar signature');
    const [name,rawParams,resultType]=fields.map(d=>d.value);
    const params=denseArray(rawParams,128,'invalid scalar signature');
    if(params.some(p=>typeof p!=='string'||!NAME.test(p))||
       new Set(params).size!==params.length||resultType!=='int')
      throw Error('invalid scalar signature');
    return Object.freeze({name,params:Object.freeze(params),resultType:'int'});
  }).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  validatePublicNames(sorted.map(e=>e.name));
  Object.freeze(sorted);
  const canonical=JSON.stringify({schema:'atto-js-scalar-interface-v2',target,hostABI:HOST_ABI,
    integerModel:'signed-i64-wrap-provisional',entries:sorted});
  return Object.freeze({entries:sorted,sha256:createHash('sha256').update(canonical).digest('hex')});
}
