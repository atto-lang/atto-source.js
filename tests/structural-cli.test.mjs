import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,access,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const cli=join(root,'bin/oreslang-jsc.mjs');
const field=(name,type,publicly=true)=>({name,type,public:publicly});
const fixture=()=>({
 schemaVersion:1,kind:'readonly-scalar-projection',mode:'explicit',
 carrier:{kind:'class',name:'User',fields:[field('id','int'),field('title','string'),field('secret','bool',false)]},
 view:{kind:'interface',readOnly:true,fields:[field('id','int')]},
 slots:['42','sample',true],select:'id'
});
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:15000});
async function work(fn){
 const dir=await mkdtemp(join(root,'tests','tmp-structural-cli-'));
 try{return await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}
}
const missing=async path=>assert.rejects(access(path),{code:'ENOENT'});

test('CLI --structural-ir --check validates without publishing artifacts',()=>work(async dir=>{
 const source=join(dir,'fixture.json'),out=join(dir,'out.mjs');
 await writeFile(source,JSON.stringify(fixture()),{mode:0o600});
 let result=run('--structural-ir','--check',source);
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'OK\n');
 await missing(out);
 result=run('--structural-ir',source,'--out='+out);
 assert.equal(result.status,0,result.stderr);
 assert.equal((await import(pathToFileURL(out).href)).main(),42n);
}));
test('named/anonymous readonly projection ESM executes for int, bool and string',()=>work(async dir=>{
 for(const [i,data,expected] of [
  [0,fixture(),42n],
  [1,{...fixture(),mode:'inline-anonymous',view:{kind:'record',readOnly:true,fields:[field('title','string')]},select:'title'},'sample'],
  [2,{...fixture(),view:{kind:'interface',readOnly:true,fields:[field('secret','bool')]},select:'secret'},null]
 ]){
  const source=join(dir,'input'+i+'.json'),out=join(dir,'main'+i+'.mjs');
  await writeFile(source,JSON.stringify(data));
  const result=run('--structural-ir',source,'--out='+out);
  if(i===2){assert.notEqual(result.status,0);await missing(out);}
  else {assert.equal(result.status,0,result.stderr);assert.equal((await import(pathToFileURL(out).href)).main(),expected);}
 }
}));
test('malformed, duplicate-key, accessor-like and injected input cannot publish ESM',()=>work(async dir=>{
 for(const [i,payload] of [
  [0,'{"schemaVersion":1,"schemaVersion":1}'],
  [1,JSON.stringify({...fixture(),slots:['42;process.exit(3)','sample',true]})],
  [2,JSON.stringify({...fixture(),slots:['9223372036854775808','sample',true]})],
  [3,JSON.stringify({...fixture(),view:{kind:'interface',readOnly:false,fields:[field('id','int')]}})],
  [4,JSON.stringify({...fixture(),intruder:{type:'any'}})]
 ]){
  const source=join(dir,'bad'+i+'.json'),out=join(dir,'bad'+i+'.mjs');
  await writeFile(source,payload);
  const result=run('--structural-ir',source,'--out='+out);
  assert.notEqual(result.status,0,'unexpected admission '+i);
  await missing(out);
 }
}));
test('typed IR CLI refuses destination overwrite and rejects UTF-8 BOM',()=>work(async dir=>{
 const source=join(dir,'input.json'),out=join(dir,'main.mjs');
 await writeFile(source,JSON.stringify(fixture()));
 await writeFile(out,'leave alone',{mode:0o600});
 let result=run('--structural-ir',source,'--out='+out);
 assert.notEqual(result.status,0);
 assert.equal(await readFile(out,'utf8'),'leave alone');
 const bom=join(dir,'bom.json');
 await writeFile(bom,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(JSON.stringify(fixture()))]));
 result=run('--structural-ir','--check',bom);
 assert.notEqual(result.status,0);
}));
