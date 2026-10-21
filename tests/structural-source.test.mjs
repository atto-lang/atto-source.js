import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileStructuralProjectionSource,parseStructuralProjectionSource} from '../src/structural-source.mjs';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const cli=join(root,'bin/oreslang-jsc.mjs');
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:15000});
const named=
  'define interface HasId\n id: int;\nend\n'+
  'define class Candidate as\n pub val int id = 42;\n pub val string label = "hi";\n val bool secret = true;\nend\n'+
  'fnc take(structural HasId value): int { return value.id; }\n'+
  'pub fnc main(): int { return take(new Candidate()); }\n';
const inline=
  '/* outer /* nested */ comment */\n'+
  'define class Candidate as\n pub val int id = -42;\nend\n'+
  'fnc take({ id: int } value): int { return value.id; }\n'+
  'pub fnc main(): int { return take(new Candidate()); }\n';
async function work(fn){
  const dir=await mkdtemp(join(root,'tests','tmp-structural-source-'));
  try {return await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}
}
const missing=path=>assert.rejects(access(path),{code:'ENOENT'});
async function execute(dir,name,source) {
  const src=join(dir,name+'.ores'),out=join(dir,name+'.mjs');
  await writeFile(src,source);
  assert.equal(run('--structural-source','--check',src).status,0);
  await missing(out);
  const result=run('--structural-source',src,'--out='+out);
  assert.equal(result.status,0,result.stderr);
  assert.equal(await readFile(src,'utf8'),source);
  return (await import(pathToFileURL(out).href)).main();
}
test('real Oreslang source lowers named structural interface to executable ESM',()=>work(async dir=>{
  assert.equal(await execute(dir,'named',named),42n);
}));
test('anonymous readonly field shape accepts absent and redundant structural keyword',()=>work(async dir=>{
  assert.equal(await execute(dir,'anonymous',inline),-42n);
  assert.equal(await execute(dir,'redundant',inline.replace('take({','take(structural {')),-42n);
  assert.equal(await execute(dir,'struct-anonymous',inline.replace('take({','take(struct{')),-42n);
  assert.equal(await execute(dir,'struct-redundant',inline.replace('take({','take(structural struct{')),-42n);
  assert.equal(await execute(dir,'record-anonymous',inline.replace('take({','take(record{')),-42n);
  assert.equal(await execute(dir,'record-redundant',inline.replace('take({','take(structural record{')),-42n);
}));
test('selected signed i64/bool/string physical slots remain strict',()=>work(async dir=>{
  const bool=
    'define class Candidate as pub val bool flag = true; end\n'+
    'fnc take({flag:bool} x):bool { return x.flag; }\n'+
    'pub fnc main():bool {return take(new Candidate());}\n';
  const string=
    'define class Candidate as pub val string label = "hello"; end\n'+
    'fnc take(structural {label:string} x):string { return x.label; }\n'+
    'pub fnc main():string {return take(new Candidate());}\n';
  assert.equal(await execute(dir,'bool',bool),true);
  assert.equal(await execute(dir,'string',string),'hello');
  assert.equal(await execute(dir,'min64',inline.replace('-42','-9223372036854775808')),-9223372036854775808n);
}));
test('unsupported ownership, private members, numeric coercion, async and source injection fail before publication',()=>work(async dir=>{
  const invalid=[
    named.replace('pub val int id','val int id'),
    named.replace('structural HasId','HasId'),
    named.replace('value.id;','value.secret;'),
    named.replace('value.id;','value.id = 5;'),
    named.replace('value.id;','await value.id;'),
    named.replace('id: int','id: float'),
    named.replace('id = 42','id = 9223372036854775808'),
    named.replace('fnc take','actor fnc take'),
    named.replace('return value.id','return value.id; process.exit(9)'),
    named.replace('return take(new Candidate());','return take(new Candidate());\n do nb {}'),
    inline.replace('fnc take','async fnc take'),
    named+'pub fnc other():int {return 7;}'
  ];
  for(let i=0;i<invalid.length;i++){
    const path=join(dir,'bad'+i+'.ores'),out=join(dir,'bad'+i+'.mjs');
    await writeFile(path,invalid[i]);
    const result=run('--structural-source',path,'--out='+out);
    assert.notEqual(result.status,0,'bad case admitted '+i);
    await missing(out);
    assert.equal(await readFile(path,'utf8'),invalid[i]);
  }
}));
test('bounded parser returns checked-IR profile and existing output remains untouched',()=>work(async dir=>{
  const parsed=parseStructuralProjectionSource(named);
  assert.equal(parsed.kind,'readonly-scalar-projection');
  assert.equal(parsed.mode,'explicit');
  assert.equal(parsed.view.kind,'interface');
  assert.equal(parsed.carrier.fields.length,3);
  assert.match(compileStructuralProjectionSource(named),/export function main/);
  const path=join(dir,'in.ores'),out=join(dir,'already.mjs');
  await writeFile(path,named);await writeFile(out,'untouched');
  assert.notEqual(run('--structural-source',path,'--out='+out).status,0);
  assert.equal(await readFile(out,'utf8'),'untouched');
  assert.throws(()=>parseStructuralProjectionSource(named+'\n/* unterminated'),/unterminated|expected/);
}));
