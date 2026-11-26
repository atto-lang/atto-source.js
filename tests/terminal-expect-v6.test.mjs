import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

const exact="pub fnc main(): int {\n  val Option<int> missing = None;\n  val Result<int, Error> ignored = trap! missing.expect(\"explicit panic control\");\n  return 101;\n}\n";
function blob(source){const b=Buffer.from(source);return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');}
async function guest(source){
 const ir=compileToProgramIRV2(source), esm=compileProgramV2(source);
 assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
 return import('data:text/javascript,'+encodeURIComponent(esm));
}
const panic=(message,cause)=>e=>e.effect==='panic'&&e.message===message&&e.cause===cause&&Object.isFrozen(e);
test('exact v6 terminal expect bypasses trap',async()=>{
 assert.equal(blob(exact),'864e6b34fe46de9c260a7e537f3f008caa7c8b79');
 const compiled=await guest(exact);
 assert.throws(()=>compiled.main(),panic('explicit panic control',undefined));
});
test('Option and Result expect success and terminal failure through nested traps',async()=>{
 for(const [type,yes,no,cause] of [['Option<int>','Some(42)','None',undefined],['Result<int,int>','Ok(42)','Err(9)',9n]]){
  const source='fnc read('+type+' x):int throws(){return x.expect("stop");} pub fnc main(bool present):int throws(){val r=trap! (trap! read(present?'+yes+':'+no+'));return r.unwrap();}';
  // unwrap of a trap result itself is an ordinary effect, so the public caller
  // must not promise a closed throws row.
  const g=await guest(source.replace('main(bool present):int throws()','main(bool present):int'));
  assert.equal(g.main(true),42n);
  assert.throws(()=>g.main(false),panic('stop',cause));
 }
});
test('expect rejects forged or cross-module carriers and malformed messages',async()=>{
 const g=await guest('pub fnc make():Option<int>{return None;} pub fnc read(Option<int> x):int{return x.expect("stop");}');
 assert.throws(()=>g.read(g.make()),panic('stop',undefined));
 const forged=Object.freeze(Object.assign(Object.create(null),{kind:'None',value:null}));
 assert.throws(()=>g.read(forged),/untrusted Option expect carrier/);
 assert.throws(()=>g.read(new Proxy(g.make(),{})),/untrusted Option expect carrier/);
 const other=await guest('pub fnc make():Option<int>{return None;}');
 assert.throws(()=>g.read(other.make()),/untrusted Option expect carrier/);
 for(const expr of ['x.expect()','x.expect(42)','x.expect("a","b")']){
  assert.throws(()=>compileProgramV2('pub fnc read(Option<int> x):int{return '+expr+';}'),/error:/);
 }
 const ir=compileToProgramIRV2('pub fnc read(Option<int> x):int{return x.expect("stop");}');
 for(const mutate of [x=>x.functions[0].body.name='Result.expect',x=>x.functions[0].body.args.pop(),x=>x.functions[0].body.args[1]={kind:'int',value:'42'}]){
  const bad=JSON.parse(JSON.stringify(ir));mutate(bad);
  assert.throws(()=>compileProgramIRV2(bad),/error: program IR:/);
 }
});
