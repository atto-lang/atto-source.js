import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker, TranspileError} from '../src/transpile-worker.mjs';

const scalar='pub fnc main(): int { return 6 * 7; }';
const actor=`define actor Counter as
 let int total = 0;
 receive(ActorMail<int> mail): void {
  self.total = self.total + mail.value;
  stdio.println(self.total);
  return;
 }
end
pub fnc main(): int { val counter = spawn Counter(); return 0; }`;

test('raw NUL ESC DEL controls fail even when hidden in comments',()=>{
  for(const code of [0,0x1b,0x7f]){
    const hidden=String.fromCharCode(code);
    for(const src of [hidden+scalar, scalar+' // '+hidden,
      '/* '+hidden+' */'+scalar,
      scalar.replace('return','/*'+hidden+'*/ return'),
      actor+'\n// '+hidden]){
      assert.throws(()=>transpile_to_worker(src),e=>
        e instanceof TranspileError&&e.code==='E_RAW_SOURCE_CONTROL');
    }
  }
});
test('literal escape text, visible Unicode and normal source remain valid',()=>{
  for(const src of [scalar,actor,'// visible \\x1b \\x7f \\0\n'+scalar,
    '// café\n'+scalar]){
    assert.doesNotThrow(()=>transpile_to_worker(src));
  }
});
