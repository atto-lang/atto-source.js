import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,existsSync,rmSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileFunctionalPipelineSource as compile} from '../src/functional-pipelines.mjs';
const src=readFileSync(new URL('./fixtures/comparator-v1/function-pipeline.atto',import.meta.url));
const text=src.toString('utf8');
const cli=fileURLToPath(new URL('../bin/atto-jsc.mjs',import.meta.url));
const error=(s,code,allowStdio=true)=>assert.throws(()=>compile(s,{allowStdio}),e=>e.code===code);
test('exact comparator blob executes generated guest with explicit stdout authority',async()=>{
  assert.equal(createHash('sha1').update('blob '+src.length+'\0').update(src).digest('hex'),'a29743b5ca5c415fd5896186cdeb88e2eb406dcf');
  error(text,'E_PERMISSION',false);
  const code=compile(text,{allowStdio:true});
  assert.equal(code,compile(text,{allowStdio:true}));
  assert.doesNotMatch(code,/\bconsole\b|\bprocess\b|\beval\b|\bimport\b/);
  const module=await import('data:text/javascript,'+encodeURIComponent(code));
  assert.throws(()=>module.main(),/E_PERMISSION/);
  const output=[];assert.equal(module.main(v=>{assert.equal(typeof v,'bigint');output.push(v);}),121n);
  assert.deepEqual(output,[121n]);
});
test('CLI refuses artifact without capability and executes the exact source in a fresh process',()=>{
  const dir=mkdtempSync(join(tmpdir(),'atto-js-comparator-'));
  try{
    const input=join(dir,'source.atto'),output=join(dir,'guest.mjs');
    writeFileSync(input,src);
    const run=(...args)=>spawnSync(process.execPath,args,{encoding:'utf8',timeout:15000});
    let r=run(cli,'--functional-source',input,'--out='+output);
    assert.equal(r.status,1);assert.match(r.stderr,/E_PERMISSION/);assert.equal(existsSync(output),false);
    r=run(cli,'--functional-source','--allow-stdio',input,'--out='+output);
    assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');
    r=run('--input-type=module','-e','import {pathToFileURL} from "node:url";const guest=await import(pathToFileURL(process.argv[1]));const result=guest.main(v=>process.stdout.write(String(v)+"\\n"));process.stderr.write(String(result)+"\\n");',output);
    assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'121\n');assert.equal(r.stderr,'121\n');
    assert.deepEqual(readFileSync(input),src);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('negative authority, shape, types, flow and unicode control checks',()=>{
  const main=body=>'pub fnc main(): int { '+body+' }';
  error(main('stdio.println(42); return 42;'),'E_PERMISSION',false);
  error(main('stdio.read(42); return 42;'),'E_STDIO');
  error(main('stdio.println(true); return 42;'),'E_TYPE');
  error(main('stdio.println(missing); return 42;'),'E_SYMBOL');
  error(main('stdio.println(1,2); return 42;'),'E_PARSE');
  error(main('stdio.println(1); val x=42; return x;'),'E_PARSE');
  error(main('stdio.println(1); '.repeat(5)+'return 42;'),'E_LIMIT');
  error('fnc f(): int {stdio.println(1);return 1;} '+main('return f();'),'E_PERMISSION');
  error('fnc f(): int {return main();} '+main('stdio.println(1);return 1;'),'E_EFFECT_CALL');
  error('// hidden \u202e\n'+main('return 42;'),'E_SOURCE');
  error(main('return 42;')+'\u00a0','E_SOURCE');
  assert.doesNotThrow(()=>compile('// LANGUAGE — preview\n'+main('return 42;')));
});
test('overflow before print cannot emit output; pure API remains unchanged',async()=>{
  const pure=await import('data:text/javascript,'+encodeURIComponent(compile('pub fnc main(): int {return 42;}')));
  assert.equal(pure.main(),42n);
  const code=compile('pub fnc main(): int {stdio.println(9223372036854775807+1);return 0;}',{allowStdio:true});
  const guest=await import('data:text/javascript,'+encodeURIComponent(code));
  const outputs=[];assert.throws(()=>guest.main(v=>outputs.push(v)),/E_OVERFLOW/);assert.deepEqual(outputs,[]);
});
