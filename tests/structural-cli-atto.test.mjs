import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,symlink,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const cli=resolve(fileURLToPath(new URL('../bin/atto-jsc.mjs',import.meta.url)));
const named=[
  'define interface HasId', ' id: int;', 'end',
  'define class C as', ' pub val int id = 42;', 'end',
  'fnc take(structural HasId x): int {return x.id;}',
  'pub fnc main(): int {return take(new C());}'
].join('\n');
const fixture={schemaVersion:1,kind:'readonly-scalar-projection',mode:'explicit',
  carrier:{kind:'class',name:'C',fields:[{name:'id',type:'int',public:true}]},
  view:{kind:'interface',readOnly:true,fields:[{name:'id',type:'int',public:true}]},
  slots:['42'],select:'id'};
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:15000});
async function isolated(cb){
 const dir=await mkdtemp(join(tmpdir(),'atto-structural-cli-'));
 try{return await cb(dir)}finally{await rm(dir,{recursive:true,force:true})}
}
test('Atto source CLI checks and publishes executable portable ESM',()=>isolated(async dir=>{
  const input=join(dir,'input.atto'),output=join(dir,'generated.mjs');
  await writeFile(input,named);
  const check=run('--structural-source','--portable','--check',input);
  assert.equal(check.status,0,check.stderr);
  assert.equal(check.stdout,'OK\n');
  const build=run('--structural-source','--portable',input,'--out='+output);
  assert.equal(build.status,0,build.stderr);
  const code=await readFile(output,'utf8');
  assert.doesNotMatch(code,/\bimport\b|@oreslang\/source-js|@atto-lang\/source-js/);
  assert.equal((await import(pathToFileURL(output).href)).main(),42n);
  assert.equal(await readFile(input,'utf8'),named);
}));

test('strict JSON typed IR input checks and publishes correct output',()=>isolated(async dir=>{
  const input=join(dir,'input.json'),output=join(dir,'generated.mjs');
  await writeFile(input,JSON.stringify(fixture));
  assert.equal(run('--structural-ir','--portable','--check',input).status,0);
  const build=run('--structural-ir','--portable',input,'--out='+output);
  assert.equal(build.status,0,build.stderr);
  assert.equal((await import(pathToFileURL(output).href)).main(),42n);
}));

test('existing output is never clobbered even on otherwise-valid compilation',()=>isolated(async dir=>{
  const input=join(dir,'input.atto'),output=join(dir,'existing.mjs');
  await writeFile(input,named);await writeFile(output,'untouched');
  const attempt=run('--structural-source','--portable',input,'--out='+output);
  assert.notEqual(attempt.status,0);
  assert.equal(await readFile(output,'utf8'),'untouched');
  const files=await import('node:fs/promises').then(fs=>fs.readdir(dir));
  assert.deepEqual(files.sort(),['existing.mjs','input.atto']);
}));

test('symlink, BOM and invalid UTF-8 source files fail before output publication',()=>isolated(async dir=>{
  const src=join(dir,'input.atto'),link=join(dir,'link.atto'),bad=join(dir,'bad.atto');
  const out=join(dir,'output.mjs');await writeFile(src,named);await symlink(src,link);
  assert.notEqual(run('--structural-source','--portable','--check',link).status,0);
  await writeFile(bad,Buffer.from([0xef,0xbb,0xbf,...Buffer.from(named)]));
  assert.notEqual(run('--structural-source','--portable',bad,'--out='+out).status,0);
  await writeFile(bad,Buffer.from([0xc3,0x28]));
  assert.notEqual(run('--structural-source','--portable',bad,'--out='+out).status,0);
  await assert.rejects(stat(out),{code:'ENOENT'});
}));

test('duplicate or escaped alias JSON keys and unsafe numeric input are denied',()=>isolated(async dir=>{
  const file=join(dir,'input.json'),out=join(dir,'output.mjs');
  for(const json of ['{"kind":1,"kind":2}',
    '{"kind":1,"\\u006bind":2}',JSON.stringify(fixture).replace('"42"','9223372036854775808'),
    JSON.stringify(fixture).replace('"42"','1.0000000000000001')]){
    await writeFile(file,json);
    const result=run('--structural-ir','--portable',file,'--out='+out);
    assert.notEqual(result.status,0,json);
    await assert.rejects(stat(out),{code:'ENOENT'});
  }
}));

test('CLI rejects absent dialect, relative outputs and output argument in check mode',()=>isolated(async dir=>{
 const file=join(dir,'input.atto');await writeFile(file,named);
 assert.notEqual(run(file).status,0);
 assert.notEqual(run('--structural-source','--portable',file,'--out=relative.mjs').status,0);
 assert.notEqual(run('--structural-source','--portable','--check',file,'--out='+join(dir,'out.mjs')).status,0);
 assert.notEqual(run('--structural-source','--portable').status,0);
}));

test('unproven source profiles are not emitted to disk',()=>isolated(async dir=>{
 const file=join(dir,'input.atto'),output=join(dir,'output.mjs');
 await writeFile(file,named.replace('pub val int id','val int id'));
 const r=run('--structural-source','--portable',file,'--out='+output);
 assert.notEqual(r.status,0);
 await assert.rejects(stat(output),{code:'ENOENT'});
}));
