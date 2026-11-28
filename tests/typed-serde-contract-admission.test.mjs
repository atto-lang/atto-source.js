import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';

// Actual source compilation, not a wire codec or auto-derive implementation.
test('codec-like ordinary methods retain their explicit callable semantics',async()=>{
  const source=[
    'pub define class User as pub to_json():int{return 42;} end',
    'pub fnc run():int{return new User().to_json();}'
  ].join('\n');
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.classes[0].methods.length,1);
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(compileProgramV2(source)));
  assert.equal(mod.run(),42n);
  assert.equal(new mod.User().to_json(),42n);
  assert.equal(typeof new mod.User().serialize,'undefined');
});
test('a class name alone does not synthesize serializable capabilities',()=>{
  for(const method of ['to_json','to_message_pack','serialize','deserialize']){
    const source='define class User as end pub fnc run():int{return new User().'+method+'();}';
    assert.throws(()=>compileProgramV2(source),/error: program v2:|error: program IR:/,method);
  }
});
test('unlowered derive and codec result types cannot silently emit scalar code',()=>{
  for(const source of [
    'define class User as end with Serializable; pub fnc run():int{return 0;}',
    'define class User as pub to_message_pack():Result<Bytes,EncodeError>{return 42;} end',
    'define class User as pub serialize():Bytes{return 42;} end'
  ]) assert.throws(()=>compileProgramV2(source),/error: program v2:|error: program IR:/,source);
});
