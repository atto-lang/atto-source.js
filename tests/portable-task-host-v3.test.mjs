import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortableTaskHostV3,verifyPortableTaskGuestV3,PORTABLE_TASK_V3}
  from '../src/portable-task-host-v3.mjs';
const bare=new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));
function custom(name,bytes) {
  const text=new TextEncoder().encode(name);
  const body=new Uint8Array(1+text.length+bytes.length);
  body[0]=text.length;body.set(text,1);body.set(bytes,text.length+1);
  const data=new Uint8Array(8+2+body.length);
  data.set([0,97,115,109,1,0,0,0]);
  data[8]=0;data[9]=body.length;data.set(body,10);
  return new WebAssembly.Module(data);
}
test('portable v3 rejects bare, non-Wasm and mismatched version artifacts',()=>{
  assert.equal(PORTABLE_TASK_V3,'atto.browser.guest.v3');
  assert.throws(()=>verifyPortableTaskGuestV3(null),/E_V3_MODULE/);
  assert.throws(()=>verifyPortableTaskGuestV3(bare),/E_V3_MARKER/);
  assert.throws(()=>verifyPortableTaskGuestV3(custom(PORTABLE_TASK_V3,[2])),/E_V3_MARKER/);
  assert.throws(()=>verifyPortableTaskGuestV3(custom(PORTABLE_TASK_V3,[3])),
    /E_V3_COMPAT_MARKER/);
  assert.throws(()=>createPortableTaskHostV3({module:bare}),/E_V3_MARKER/);
});
