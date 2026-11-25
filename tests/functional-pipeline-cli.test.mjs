import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const cli=resolve(fileURLToPath(new URL('../bin/atto-jsc.mjs',import.meta.url)));
const canonical=resolve(fileURLToPath(new URL('./fixtures/functional-pipelines-v1/block-body.atto',import.meta.url)));
const source=await readFile(canonical,'utf8');
function invoke(...args){return spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:15000});}
async function isolated(fn){
  const dir=await mkdtemp(join(tmpdir(),'atto-js-pipe-cli-'));
  try{return await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}
}
test('source CLI checks and generates independent executable guest',()=>isolated(async dir=>{
  const input=join(dir,'input.atto'),output=join(dir,'guest.mjs');
  await writeFile(input,source);
  const check=invoke('--functional-source','--check',input);
  assert.equal(check.status,0,check.stderr);
  assert.equal(check.stdout,'OK\n');
  await assert.rejects(stat(output),{code:'ENOENT'});
  const build=invoke('--functional-source',input,'--out='+output);
  assert.equal(build.status,0,build.stderr);
  assert.equal(build.stdout,'');
  assert.equal((await import(pathToFileURL(output).href)).main(),83n);
  assert.equal(await readFile(input,'utf8'),source);
  const second=invoke('--functional-source',input,'--out='+output);
  assert.notEqual(second.status,0,'no-overwrite publication required');
  assert.equal((await import(pathToFileURL(output).href)).main(),83n);
}));
test('CLI rejects malformed typed inputs before artifact creation',()=>isolated(async dir=>{
  const input=join(dir,'input.atto'),output=join(dir,'guest.mjs');
  await writeFile(input,'pub fnc main(): int -> 20 |> missing;');
  const bad=invoke('--functional-source',input,'--out='+output);
  assert.notEqual(bad.status,0);
  assert.match(bad.stderr,/E_SYMBOL/);
  await assert.rejects(stat(output),{code:'ENOENT'});
}));
test('CLI rejects symlink input and non-Atto extension',()=>isolated(async dir=>{
  const input=join(dir,'input.atto'),link=join(dir,'link.atto'),bad=join(dir,'input.txt');
  await writeFile(input,source);
  await writeFile(bad,source);
  await symlink(input,link);
  assert.notEqual(invoke('--functional-source','--check',link).status,0);
  assert.notEqual(invoke('--functional-source','--check',bad).status,0);
}));
