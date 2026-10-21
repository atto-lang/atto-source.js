import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileStructuralProjectionIR} from '../src/structural-projection-ir.mjs';
const f=(name,type,publicly=true)=>({name,type,public:publicly});
const ir=(over={})=>({schemaVersion:1,kind:'readonly-scalar-projection',mode:'explicit',
  carrier:{kind:'class',name:'Customer',fields:[f('id','int'),f('label','string'),f('secret','bool',false)]},
  view:{kind:'interface',readOnly:true,fields:[f('id','int')]},slots:['42','hello',true],select:'id',...over});
async function run(program){
 const root=await mkdtemp(join(dirname(fileURLToPath(import.meta.url)),'tmp-structural-ir-'));
 try{const path=join(root,'module.mjs');await writeFile(path,compileStructuralProjectionIR(program),{mode:0o600});
  return (await import(pathToFileURL(path).href)).main();}finally{await rm(root,{recursive:true,force:true});}
}
test('actual ESM executes readonly named structural projection',async()=>{
 assert.equal(await run(ir()),42n);
 assert.equal(await run(ir({view:{kind:'interface',readOnly:true,fields:[f('label','string')]},select:'label'})),'hello');
});
test('anonymous inline record projection does not require redundant structural keyword',async()=>{
 assert.equal(await run(ir({mode:'inline-anonymous',view:{kind:'record',readOnly:true,fields:[f('id','int')]}})),42n);
});
test('mismatched/private/unsound views reject before artifact emission',()=>{
 assert.throws(()=>compileStructuralProjectionIR(ir({view:{kind:'interface',readOnly:true,fields:[f('secret','bool')]},select:'secret'})),/shape proof failed/);
 assert.throws(()=>compileStructuralProjectionIR(ir({view:{kind:'interface',readOnly:true,fields:[f('id','float')]}})),/descriptor|shape/);
 assert.throws(()=>compileStructuralProjectionIR(ir({view:{kind:'interface',readOnly:false,fields:[f('id','int')]}})),/readonly/);
 assert.throws(()=>compileStructuralProjectionIR(ir({mode:'inline-anonymous'})),/anonymous/);
 assert.throws(()=>compileStructuralProjectionIR(ir({select:'secret'})),/not in readonly/);
});
test('checked i64 extremes, string and boolean values execute without coercion',async()=>{
 for(const v of ['-9223372036854775808','9223372036854775807','0']){
  assert.equal(await run(ir({slots:[v,'hi',false]})),BigInt(v));
 }
 assert.equal(await run(ir({carrier:{kind:'record',fields:[f('id','int'),f('flag','bool')]},view:{kind:'record',readOnly:true,fields:[f('flag','bool')]},slots:['42',true],select:'flag'})),true);
});
test('forged, accessor, sparse and extra-key metadata reject',()=>{
 const x=ir();Object.defineProperty(x,'slots',{get(){throw Error('getter ran')}});
 assert.throws(()=>compileStructuralProjectionIR(x),/accessor denied/);
 const y=ir({slots:[,'hello',true]});assert.throws(()=>compileStructuralProjectionIR(y),/noncanonical|sparse/);
 assert.throws(()=>compileStructuralProjectionIR(ir({intruder:'oops'})),/unrecognized/);
 const z=ir();Object.defineProperty(z.view.fields,'0',{get(){throw Error('getter ran')}});
 assert.throws(()=>compileStructuralProjectionIR(z),/accessor-backed/);
});
test('slot literals cannot inject source code or coerce numeric slots',()=>{
 assert.throws(()=>compileStructuralProjectionIR(ir({slots:['1; process.exit(3)','hello',true]})),/i64 literal/);
 assert.throws(()=>compileStructuralProjectionIR(ir({slots:[1,'hello',true]})),/i64 literal/);
 assert.throws(()=>compileStructuralProjectionIR(ir({slots:['9223372036854775808','hello',true]})),/out of range/);
 assert.throws(()=>compileStructuralProjectionIR(ir({slots:['42','hello','true']})),/bool slot/);
});
