import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectExecutionDomains} from '../src/execution-domain-admission.mjs';

// This is the token-admission boundary, not a proof of task lowering or scheduling.
test('execution-domain admission preserves token kinds and explicit inline opt-in',()=>{
  let count=0;
  const token=(kind,value)=>({kind,value});
  const id=value=>token('id',value), sym=value=>token('sym',value);
  const fail=(message,t)=>{throw Object.assign(new Error(message),{token:t});};
  for(const inlineScalarTasks of [false,true]) {
    for(const word of ['cpu','gpu','quantum','task','nb','other']) {
      for(const prev of [null,id('sync'),id('await'),token('string','sync'),sym('sync')]) {
        for(const next of [null,sym('{'),sym('('),token('string','{'),sym('<')]) {
          for(const kind of ['id','string','sym']) {
            const middle=token(kind,word);
            const list=[prev,middle,next].filter(Boolean);
            const domain=kind==='id'&&['cpu','gpu','quantum'].includes(word);
            const block=next?.kind==='sym'&&next.value==='{';
            const denied=domain||(kind==='id'&&block&&(word==='nb'||(word==='task'&&!(inlineScalarTasks&&prev?.kind==='id'&&prev.value==='sync'))));
            const label=JSON.stringify({inlineScalarTasks,prev,middle,next});
            if(denied) assert.throws(()=>rejectExecutionDomains(list,fail,{inlineScalarTasks}),e=>e.token===middle&&/reserved|scheduler-aware/.test(e.message),label);
            else assert.doesNotThrow(()=>rejectExecutionDomains(list,fail,{inlineScalarTasks}),label);
            count++;
          }
        }
      }
    }
  }
  assert.equal(count,900);
  assert.throws(()=>rejectExecutionDomains([id('sync'),id('task'),sym('{')],fail),/scheduler-aware/);
});
