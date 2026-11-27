import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const source='fnc rhs():bool { stdio.out.write("R"); val Option<bool> x=None; return x.unwrap(); } pub fnc main(bool run):int { val Result<bool, Error> r=trap! (run && rhs()); return r.is_err()?42:17; }';
const opt={stdout:true};
test('stdout requires explicit source and IR capability; skipped branch has no output',async()=>{
 assert.throws(()=>compileProgramV2(source),/E_STDOUT_PROFILE/);
 const ir=compileToProgramIRV2(source,opt);
 assert.throws(()=>compileProgramIRV2(ir),/E_STDOUT_PROFILE/);
 const esm=compileProgramV2(source,opt);
 assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir)),opt),esm);
 const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
 assert.throws(()=>guest.main(true),/explicit stdout capability/);
 let a='',b='';
 assert.equal(guest.main(s=>{a+=s;},false),17n);
 assert.equal(a,'');
 assert.equal(guest.main(s=>{b+=s;},true),42n);
 assert.equal(b,'R');
 assert.throws(()=>guest.main(()=>{throw new Error('host failure');},true),/stdout capability failed/);
 assert.throws(()=>guest.main(()=>1,true),/stdout capability failed/);
});
test('stdout rejects shadowing, nonliteral, forged message, and wrong arity',()=>{
 for(const bad of [source.replace('fnc rhs()', 'fnc rhs(bool stdio)'),source.replace('write("R")','write(42)'),source.replace('write("R")','write("R","S")')])assert.throws(()=>compileProgramV2(bad,opt),/error:/);
 const ir=compileToProgramIRV2(source,opt);
 ir.functions.find(f=>f.name==='rhs').body.message=42;
 assert.throws(()=>compileProgramIRV2(ir,opt),/error:/);
});

test('canonical process.stdout.write is equivalent and shadowing remains denied',async()=>{
 const alternate=source.replace('stdio.out.write','process.stdout.write');
 const ir=compileToProgramIRV2(alternate,opt);
 const esm=compileProgramV2(alternate,opt);
 assert.equal(esm,compileProgramV2(source,opt));
 assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir)),opt),esm);
 const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
 let out='';assert.equal(guest.main(s=>{out+=s;},true),42n);assert.equal(out,'R');
 const shadow='pub fnc main(bool process):int { process.stdout.write("R"); return 42; }';
 assert.throws(()=>compileProgramV2(shadow,opt),/E_STDOUT_PROFILE/);
});

test('root stdout cleanup is scoped, capability-gated and LIFO',async()=>{
 const root='pub fnc main():int { defer stdio.out.write("A"); defer process.stdout.write("B"); stdio.out.write("C"); return 42; }';
 assert.throws(()=>compileProgramV2(root),/E_STDOUT_PROFILE/);
 for(const bad of [root.replace('main()','main(bool process)'),root.replace('write("B")','write(42)'),root.replace('defer stdio.out.write("A");','if true { defer stdio.out.write("A"); return 42; }')])assert.throws(()=>compileProgramV2(bad,opt),/error:/);
 const ir=compileToProgramIRV2(root,opt);
 assert.throws(()=>compileProgramIRV2(ir),/E_STDOUT_PROFILE/);
 const esm=compileProgramV2(root,opt);
 assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir)),opt),esm);
 const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
 let out='';assert.equal(guest.main(s=>{out+=s;}),42n);assert.equal(out,'CBA');
 ir.functions[0].body.message=42;
 assert.throws(()=>compileProgramIRV2(ir,opt),/E_STDOUT_PROFILE/);
});
