import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIR,compileIR} from '../src/compiler.mjs';
const source=body=>'pub fnc main(): int { '+body+' }';
const run=async body=>(await import('data:text/javascript;base64,'+Buffer.from(compileIR(compileToIR(source(body)))).toString('base64'))).main();
test('computed DynRecord labels use decoded compile-time string identity',async()=>{
  for(const body of ["const key=\"first name\"; val r=([key]=42); return r[\"first name\"];","const prefix=\"content-\"; const DynRecord r=([prefix+\"type\"]:42); return r[\"content-type\"];","const Record r={metadata:([\"request\"+\" id\"]=42)}; return r.metadata[\"request id\"];","const DynRecord<infer T> a=([\"x\"+\"-y\"]:1); const DynRecord<T> b=(\"x-y\"=42); return b[\"x-y\"];","const DynRecord r=([\"\\u0078\"]:42); return r.x;"])assert.equal(await run(body),42n,body);
});
test('computed key boundary rejects nonconstant, malformed, mixed and duplicate labels',()=>{
  for(const body of ["const n=1; val r=([n]=42); return 0;","val r=([missing]=42); return 0;","const Record r={[\"x\"]:42}; return 0;","val r=([\"x\"]=1,\"x\":2); return 0;","val r=([\"\\u0078\"]=1,\"x\":2); return 0;","val r=([\"x\"]=1,x:2); return 0;","val r=([\"\"]=42); return 0;","val r=([\"x\"*2]=42); return 0;","val r=([\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"]=42); return 0;","val r=([\"\\ud800\"]=42); return 0;","val r=(\"\\u202e\"=42); return 0;"])assert.throws(()=>compileToIR(source(body)),undefined,body);
  assert.throws(()=>compileToIR('pub fnc main(int key):int{val r=([key]=42);return 0;}'),/E_RECORD_KEY/);
});
