import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {compileCountedReadyV1} from '../src/counted-select-ready-compiler.mjs';
import {compile} from '../src/compiler.mjs';
const fixtures=[{"name":"counted-mixed-future-alias","sha":"8f57de03c9fb44eb5594c99a7095f34b702a266a"},{"name":"counted-multi-channel-fair","sha":"4b9b79b9b8670f5b282d33e63b7a4b5691c2979a"},{"name":"counted-mixed-zero","sha":"458323db6019da434b97e5b966ee646411310acf"},{"name":"counted-three","sha":"6531efa0689f2a5728b40a6412651e8143e45865"},{"name":"counted-zero","sha":"42e49fc1eea64b31e86ec722e1457c1ab706a7e1"},{"name":"counted-one","sha":"910062ebf96613d15a16ddb080abd89375d7709c"}];
test('actual CLI emits ESM and six exact closed-world guest sources execute to 42',async()=>{
  const dir=await mkdtemp(join(process.cwd(),'.counted-ready-'));
  try{
    for(const f of fixtures){
      const input=new URL('./fixtures/select-source-v2/'+f.name+'.atto',import.meta.url);
      const raw=await readFile(input);
      assert.equal(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),f.sha);
      assert.throws(()=>compile(raw.toString('utf8'))); // old scalar gate intact
      const path=join(dir,f.name+'.mjs');
      const child=spawnSync(process.execPath,['bin/oreslang-jsc.mjs','--counted-ready-v1',input.pathname,'--out='+path],{encoding:'utf8'});
      assert.equal(child.status,0,child.stderr);
      const emitted=await import(pathToFileURL(path));
      assert.equal(await emitted.main(),42n,f.name);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('unsupported types, effects, projection captures, escaped futures and negative counts never emit',()=>{
  const prefix='suspends fnc main(): int { val Channel<int> a = Channel.new<int>(1); writech a, 42; ';
  const base='val Array[int] values = await select<int>(1) { when readch a: int n -> { return n; } }; return values[0]; }';
  for(const text of [base.replace('(1)','(-1)'),base.replace('(1)','(true)'),base.replace('return n;','return n + a;'),base.replace('readch a','readch missing'),base.replace('Array[int]','int'),base.replace('when readch a: int n','default:'),base.replace('await select','select'),base+' return 0;'])assert.throws(()=>compileCountedReadyV1(prefix+text),/E_COUNTED_READY_PROFILE/);
  assert.throws(()=>compileCountedReadyV1('pub fnc main(): int { return 42; }'),/E_COUNTED_READY_PROFILE/);
});
test('runtime rejects would-suspend instead of hanging or pretending full scheduler support',async()=>{
  const source='suspends fnc main(): int { val Channel<int> a = Channel.new<int>(1); val Array[int] values = await select<int>(1) { when readch a: int n -> { return n; } }; return values[0]; }';
  const dir=await mkdtemp(join(process.cwd(),'.counted-ready-'));
  try{const path=join(dir,'guest.mjs');await writeFile(path,compileCountedReadyV1(source));const guest=await import(pathToFileURL(path));await assert.rejects(guest.main(),/E_READY_ONLY/);}
  finally{await rm(dir,{recursive:true,force:true});}
});
