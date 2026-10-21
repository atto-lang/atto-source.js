import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {compileStructuralProjectionIR} from '../src/structural-projection-ir.mjs';

const field=(name,type,publicly=true)=>({name,type,public:publicly});
const fixture=(overrides={})=>({
  schemaVersion:1,kind:'readonly-scalar-projection',mode:'explicit',
  carrier:{kind:'class',name:'Customer',fields:[
    field('id','int'),field('label','string'),field('privateToken','string',false)
  ]},
  view:{kind:'interface',readOnly:true,fields:[field('id','int')]},
  slots:['42','hello','PRIVATE_VALUE_NEVER_IN_BUNDLE'],select:'id',...overrides
});
async function isolated(fn){
  const dir=await mkdtemp(join(tmpdir(),'ores-js-portable-'));
  try{return await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}
}
async function evaluate(ir,dir){
  const src=compileStructuralProjectionIR(ir,{portable:true});
  const filename=join(dir,'portable.mjs');
  await writeFile(filename,src,{mode:0o600});
  return {src,value:(await import(pathToFileURL(filename).href)).main()};
}
test('portable ESM executes outside the source-js package without dependency resolution',()=>isolated(async dir=>{
  const {src,value}=await evaluate(fixture(),dir);
  assert.equal(value,42n);
  assert.doesNotMatch(src,/\\bimport\\b|@oreslang\\/source-js/);
  assert.doesNotMatch(src,/PRIVATE_VALUE_NEVER_IN_BUNDLE|hello/);
}));
test('validated anonymous readonly record projects string and blocks injection',()=>isolated(async dir=>{
  const injection='"; globalThis.__ORE_INJECTED__=1; //';
  const obj=fixture({mode:'inline-anonymous',view:{kind:'record',readOnly:true,fields:[field('label','string')]},
    select:'label',slots:['42',injection,'PRIVATE_VALUE_NEVER_IN_BUNDLE']});
  const {src,value}=await evaluate(obj,dir);
  assert.equal(value,injection);
  assert.equal(globalThis.__ORE_INJECTED__,undefined);
  assert.doesNotMatch(src,/PRIVATE_VALUE_NEVER_IN_BUNDLE/);
}));
test('portable i64 boundaries and bool preserve exact scalar representation',()=>isolated(async dir=>{
  for(const number of ['-9223372036854775808','9223372036854775807','0']){
    const {value}=await evaluate(fixture({slots:[number,'hello','hidden']}),dir);
    assert.equal(value,BigInt(number));
    // Different data URL avoids ESM cache within one temp path.
    await rm(join(dir,'portable.mjs'));
  }
  const bool=fixture({carrier:{kind:'record',fields:[field('ok','bool')]},
    view:{kind:'record',readOnly:true,fields:[field('ok','bool')]},slots:[false],select:'ok'});
  assert.equal((await evaluate(bool,dir)).value,false);
}));
test('portable lowering enforces compiler proof before code emission',()=>{
  assert.throws(()=>compileStructuralProjectionIR(fixture({
    view:{kind:'interface',readOnly:true,fields:[field('privateToken','string')]},
    select:'privateToken'}),{portable:true}),/shape proof failed/);
  assert.throws(()=>compileStructuralProjectionIR(fixture({
    view:{kind:'interface',readOnly:false,fields:[field('id','int')]}}),{portable:true}),/readonly/);
  assert.throws(()=>compileStructuralProjectionIR(fixture({
    slots:['9223372036854775808','hello','hidden']}),{portable:true}),/out of range/);
  let count=0;
  const x=fixture();Object.defineProperty(x,'slots',{get(){count++;throw Error('getter ran');}});
  assert.throws(()=>compileStructuralProjectionIR(x,{portable:true}),/accessor denied/);
  assert.equal(count,0);
});
test('CLI --structural-ir --portable publishes standalone ESM atomically',()=>isolated(async dir=>{
  const cli=resolve(fileURLToPath(new URL('../bin/oreslang-jsc.mjs',import.meta.url)));
  const json=join(dir,'input.json'),out=join(dir,'output.mjs');
  await writeFile(json,JSON.stringify(fixture()));
  const check=spawnSync(process.execPath,[cli,'--structural-ir','--portable','--check',json],
    {encoding:'utf8',timeout:15000});
  assert.equal(check.status,0,check.stderr);
  const emit=spawnSync(process.execPath,[cli,'--structural-ir','--portable',json,'--out='+out],
    {encoding:'utf8',timeout:15000});
  assert.equal(emit.status,0,emit.stderr);
  const src=await readFile(out,'utf8');
  assert.doesNotMatch(src,/\\bimport\\b|PRIVATE_VALUE_NEVER_IN_BUNDLE/);
  assert.equal((await import(pathToFileURL(out).href)).main(),42n);
  const repeat=spawnSync(process.execPath,[cli,'--structural-ir','--portable',json,'--out='+out],
    {encoding:'utf8',timeout:15000});
  assert.notEqual(repeat.status,0);
  assert.equal(await readFile(out,'utf8'),src);
}));
