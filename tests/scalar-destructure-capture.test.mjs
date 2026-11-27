import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIR,compileIR} from '../src/compiler.mjs';
const source=body=>'pub fnc main():int{'+body+'}';
async function run(body){const code=compileIR(compileToIR(source(body)));return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).main();}
test('scalar tuple/record capture preserves kind and selected values',async()=>{
 for(const body of [
 'const t=(20,22);const (a,b) as r=t;return a+r[1];',
 'const s={a:20,b:22,c:9};const {a,b} as r=s;return a+r.b+r.c-9;',
 'const t=(20,22);const (a,b) as Record r=t;return r.a+b;',
 'const t=();const () as r=t;return 42;',
 'const Record s={};const {} as r=s;return 42;',
 ])assert.equal(await run(body),42n,body);
});
test('checked shape and binding policy reject before emission',()=>{
 for(const [body,error] of [
 ['const t=(1,2);const (a) as r=t;return 0;',/E_DESTRUCTURE_ARITY/],
 ['const t=(1,2);const (a,a) as r=t;return 0;',/E_DESTRUCTURE_DUPLICATE/],
 ['const t=(1,2);const (a,b) as a=t;return 0;',/E_DESTRUCTURE_DUPLICATE/],
 ['const t=(1,2);const {a,b} as r=t;return 0;',/E_DESTRUCTURE_KIND/],
 ['const t={a:1};const {b} as r=t;return 0;',/E_DESTRUCTURE_FIELD/],
 ['const t=(1,2);const (a,b) as Array r=t;return 0;',/E_DESTRUCTURE_CONVERSION_UNSUPPORTED/],
 ['const t=(1,2);const (a,let b) as r=t;return 0;',/E_DESTRUCTURE_POLICY_UNSUPPORTED/],
 ['const t=(1,2);const [a,b] as r=t;return 0;',/E_DESTRUCTURE_ARRAY_UNSUPPORTED/],
 ])assert.throws(()=>compileToIR(source(body)),error,body);
});
