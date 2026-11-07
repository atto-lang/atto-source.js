import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  compileProgramV2,compileToProgramIRV2,compileProgramIRV2
} from '../src/program-v2.mjs';

// These assertions bind typed return signatures to actual emitted public ESM
// results. Malformed host values are injected ONLY into deliberately mutated
// final artifacts: the AttoLang compiler must never generate those payloads.
const cases=[
  {name:'int',type:'int',expression:'42',checker:'_check',
    emitted:'42n',foreign:'42',broken:'42',valid:v=>assert.equal(v,42n),
    reject:/BigInt required/},
  {name:'bool',type:'bool',expression:'true',checker:'_checkbool',
    emitted:'true',foreign:'1n',broken:'1n',valid:v=>assert.equal(v,true),
    reject:/bool required/},
  {name:'symbol',type:'Symbol',expression:'#ready',checker:'_checksymbol',
    emitted:'_symbol("ready")',foreign:'{}',broken:'{}',
    valid:v=>{assert.equal(v.name,'ready');assert.equal(v.kind,'PROCESS');
      assert.equal(Object.getPrototypeOf(v),null);assert.equal(Object.isFrozen(v),true);},
    reject:/Symbol required/},
  {name:'option',type:'Option<int>',expression:'Option.some(42)',checker:'_checkoption',
    emitted:'_some(42n)',foreign:'{}',broken:'{}',
    valid:v=>{assert.equal(v.kind,'Some');assert.equal(v.value,42n);
      assert.equal(Object.getPrototypeOf(v),null);assert.equal(Object.isFrozen(v),true);},
    reject:/tagged value required/},
  {name:'result',type:'Result<int,int>',expression:'Result.ok(42)',checker:'_checkresult',
    emitted:'_ok(42n)',foreign:'{}',broken:'{}',
    valid:v=>{assert.equal(v.kind,'Ok');assert.equal(v.value,42n);
      assert.equal(Object.getPrototypeOf(v),null);assert.equal(Object.isFrozen(v),true);},
    reject:/tagged value required/}
];
function replaceExactlyOnce(code,search,replacement){
  const start=code.indexOf(search);
  assert.notEqual(start,-1,'missing emitted return checker: '+search);
  assert.equal(code.indexOf(search,start+search.length),-1,
    'ambiguous boundary checker: '+search);
  return code.slice(0,start)+replacement+code.slice(start+search.length);
}
async function importChecked(esm,id){
  const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{
    input:esm,encoding:'utf8',timeout:10000,maxBuffer:1024*1024
  });
  assert.equal(syntax.error,undefined,id+' syntax checker spawn');
  assert.equal(syntax.status,0,id+' malformed ESM: '+syntax.stderr);
  return import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(esm)+'#return-boundary-'+encodeURIComponent(id));
}

test('typed return contract covers five types and both function/method boundaries',()=>{
  assert.equal(cases.length,5);
  assert.equal(new Set(cases.map(c=>c.checker)).size,5);
});
for(const c of cases)for(const target of ['function','method']){
  const source=target==='function'
    ? 'pub fnc get():'+c.type+'{return '+c.expression+';}'
    : 'pub define class Box as pub mtd get(self):'+c.type+
      '{return '+c.expression+';} end';
  const take=m=>target==='function'?m.get():new m.Box().get();
  test('public typed ESM return / '+target+' / '+c.name,async()=>{
    const esm=compileProgramV2(source);
    const normalized=compileProgramIRV2(JSON.parse(JSON.stringify(
      compileToProgramIRV2(source)
    )));
    assert.equal(esm,normalized,'source and typed-IR emission diverged');
    const check='return '+c.checker+'('+c.emitted+');';
    assert.ok(esm.includes(check),'missing final ESM typed return guard '+check);
    const mod=await importChecked(esm,'good-'+target+'-'+c.name);
    c.valid(take(mod));
  });
  test('wrong host return rejected by emitted ESM / '+target+' / '+c.name,async()=>{
    const esm=compileProgramV2(source);
    const boundary='return '+c.checker+'('+c.emitted+');';
    const mutant=replaceExactlyOnce(esm,boundary,
      'return '+c.checker+'('+c.foreign+');');
    const mod=await importChecked(mutant,'foreign-'+target+'-'+c.name);
    assert.throws(()=>take(mod),c.reject);
  });
  test('removing typed return guard is observable / '+target+' / '+c.name,async()=>{
    const esm=compileProgramV2(source);
    const boundary='return '+c.checker+'('+c.emitted+');';
    const mutant=replaceExactlyOnce(esm,boundary,'return '+c.broken+';');
    const mod=await importChecked(mutant,'unguarded-'+target+'-'+c.name);
    const leaked=take(mod);
    if(c.name==='int'||c.name==='bool') {
      assert.notEqual(typeof leaked,c.name==='int'?'bigint':'boolean');
    } else {
      assert.equal(Object.getPrototypeOf(leaked),Object.prototype,
        'expected forged host object to leak only in unguarded ESM');
    }
  });
}

test('void method stays void and method host receiver guard remains active',async()=>{
  const source='pub define class Box as pub mtd stop(self):void{} end';
  const esm=compileProgramV2(source);
  assert.match(esm,/return;/);
  const mod=await importChecked(esm,'void-method');
  const box=new mod.Box();
  assert.equal(box.stop(),undefined);
  assert.throws(()=>mod.Box.prototype.stop.call({}),/invalid Oreslang receiver/);
});
