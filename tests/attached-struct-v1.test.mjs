import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,isAbsolute} from 'node:path';
import {compileAttachedStruct} from '../src/attached-struct-v1.mjs';
const fixtureHead='c60198196873889fdb4f64e37f65e882e49d97ea';
const fixtureTree='02408897b5eb20da6d592206afb828da7c1a2b7e';
const required=process.env.ATTO_ATTACHED_STRUCT_REQUIRED==='1';
const run=async code=>(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).main();
const example='define struct Point { int x; int y; } with { constructor(int x, int y) { self.x = x; self.y = y; } mtd int • sum(){return self.x+self.y;} } pub fnc main():int { let p = Point(40,2); return p.sum(); }';
test('independent checked ESM emitter executes and rejects source',async()=>{
  const code=compileAttachedStruct(example);assert.equal(code,compileAttachedStruct(example));assert.equal(await run(code),42n);
  for(const s of [example+' fnc extra():int{return 1;}',example.replace('40,2','9223372036854775808,2'),example.replace('self.y = y;','self.x = y;'),example.replace('p.sum()','p.constructor()'),example.replace('Point(40,2)','Point(true,2)'),'\u202e'+example,example.replace('40,2','40,2,3')])assert.throws(()=>compileAttachedStruct(s),/E_ATTACHED_STRUCT/);
});
test('exact common attached struct corpus through independent JS source emitter',{skip:!required},async()=>{
  const root=process.env.ATTO_STRUCT_FIXTURE_ROOT;assert.ok(root&&isAbsolute(root));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:10000}).trim();
  assert.equal(git('rev-parse','HEAD'),fixtureHead);assert.equal(git('rev-parse','HEAD^{tree}'),fixtureTree);assert.equal(git('status','--porcelain','--untracked-files=all'),'');
  const dir=join(root,'fixtures/attached-struct-seven-target-v1');
  const rows=(await readFile(join(dir,'manifest.tsv'),'utf8')).trim().split('\n').map(l=>l.split('\t'));
  assert.equal(rows.length,15);assert.equal(new Set(rows.map(r=>r[0])).size,15);
  assert.deepEqual(rows.map(r=>r[0]).sort(),(await readdir(dir)).filter(n=>n.endsWith('.atto')).sort());
  const receipt={positive:0,reject:0,overflow:0};
  for(const [name,expected,...rest] of rows){assert.equal(rest.length,0);assert.match(name,/^[a-z-]+\.atto$/);assert.match(expected,/^(reject|overflow|-?(0|[1-9][0-9]*))$/);const source=await readFile(join(dir,name),'utf8');
    if(expected==='reject'){assert.throws(()=>compileAttachedStruct(source),/E_ATTACHED_STRUCT/,name);receipt.reject++;continue}
    const code=compileAttachedStruct(source);assert.equal(code,compileAttachedStruct(source),name);
    if(expected==='overflow'){await assert.rejects(run(code),/E_OVERFLOW/,name);receipt.overflow++}else{assert.equal(await run(code),BigInt(expected),name);receipt.positive++}
  }assert.deepEqual(receipt,{positive:4,reject:9,overflow:2});console.log('INDEPENDENT_JS_ATTACHED_STRUCT_RECEIPT',JSON.stringify(receipt));
});

test('contextual make invokes the declared constructor and preserves nominal category',async()=>{
  for(const spelling of ['let Point p = make {x:40,y:2};','let Point p = make {y:2,x:40};','let p = make Point {x:40,y:2};']){
    const source=example.replace('let p = Point(40,2);',spelling);
    assert.equal(await run(compileAttachedStruct(source)),42n);
  }
  for(const spelling of ['let p = make {x:40,y:2};','let Point p = new {x:40,y:2};','let Point p = make {x:40};','let Point p = make {x:40,x:2};','let Point p = make {x:true,y:2};','let Point p = make {x:40,z:2};','let Point p = make {x=40,y:2};']){
    assert.throws(()=>compileAttachedStruct(example.replace('let p = Point(40,2);',spelling)),/E_ATTACHED_STRUCT/);
  }
  const reverse=example.replace('constructor(int x, int y)','constructor(int y, int x)').replace('self.x+self.y','self.x-self.y').replace('let p = Point(40,2);','let Point p = make {x:40,y:2};');
  assert.equal(await run(compileAttachedStruct(reverse)),38n);
});
