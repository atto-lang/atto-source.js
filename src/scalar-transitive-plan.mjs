// Bounded deterministic closure of already-admitted package metadata.
// Identity is a trusted logical slot plus exact artifact digest, not a signature.
import {canonicalDependencyPlan,verifyDependencyInterface,hashText} from './scalar-dependency-plan.mjs';
import {scalarInterface} from './scalar-package-interface.mjs';
const ID=/^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$/;
const SHA=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('E_SCALAR_CLOSURE: '+m);};
const validId=s=>typeof s==='string'&&ID.test(s)&&s.split('/').every(p=>p&&p!=='.'&&p!=='..');
export function resolveScalarClosure(root,inventory){
  if(!validId(root)||!Array.isArray(inventory)||inventory.length<1||inventory.length>64)fail('invalid root or inventory');
  const nodes=new Map();
  let edges=0;
  for(const n of inventory){
    if(!n||Object.keys(n).sort().join(',')!=='dependencies,manifestSha256,moduleSha256,packageId,publicInterface'||
       !validId(n.packageId)||nodes.has(n.packageId)||!SHA.test(n.manifestSha256)||!SHA.test(n.moduleSha256)||
       typeof n.manifestSha256!=='string'||typeof n.moduleSha256!=='string'||!Array.isArray(n.dependencies))fail('invalid or duplicate package');
    const abi=scalarInterface(n.publicInterface,'edge-js');
    const dependencies=n.dependencies.length?canonicalDependencyPlan(n.dependencies).dependencies:[];
    edges+=dependencies.length;
    if(edges>512)fail('edge budget exceeded');
    nodes.set(n.packageId,{packageId:n.packageId,manifestSha256:n.manifestSha256,moduleSha256:n.moduleSha256,
      interfaceSha256:abi.sha256,publicInterface:abi.entries,dependencies});
  }
  if(!nodes.has(root))fail('missing root');
  const state=new Map(),order=[];
  function visit(id){
    if(state.get(id)===1)fail('dependency cycle at '+id);
    if(state.get(id)===2)return;
    const node=nodes.get(id);
    if(!node)fail('missing dependency '+id);
    state.set(id,1);
    for(const d of node.dependencies){
      const provider=nodes.get(d.packageId);
      if(!provider)fail('missing dependency '+d.packageId);
      verifyDependencyInterface(d,provider.publicInterface);
      visit(d.packageId);
    }
    state.set(id,2);order.push(id);
  }
  visit(root);
  if(order.length!==nodes.size)fail('unreachable package');
  const lock=order.map(id=>nodes.get(id));
  const canonical=JSON.stringify({schema:'atto-js-scalar-closure-v1',target:'edge-js',root,lock});
  if(Buffer.byteLength(canonical)>1048576)fail('lock exceeds byte budget');
  return {order,lockSha256:hashText(canonical)};
}
