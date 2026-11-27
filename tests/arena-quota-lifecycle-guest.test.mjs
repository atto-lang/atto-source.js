// Execute actual compiler-emitted JS; no host implementation of policy.
// Concatenated source is not proof of canonical module import linking.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileProgramV2} from '../src/program-v2.mjs';
const pins=[
 ['stdlib/policy/core/arena_limits.atto','5928e893a2ce1baadb0376a4ccb14f63249f77d4'],
 ['stdlib/policy/alloc/arena_lifecycle.atto','e4795c6d4bd561be3d913cdc617d103d0e2828c8'],
 ['tests/fixtures/arena-quota-lifecycle-guest.atto','2b1eb28f07b792f2727abe9a5691849f024e304a']
];
const source=pins.map(([path,pin])=>{
 const bytes=readFileSync(new URL('../'+path,import.meta.url));
 assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),pin,path);
 return bytes.toString('utf8');
}).join('\n');
test('actual Atto-to-ESM arena policy guest and wrong-oracle negative',async()=>{
 const esm=compileProgramV2(source);
 assert.equal(compileProgramV2(source),esm,'nondeterministic ESM');
 const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
 assert.equal(guest.main(),100n,'failed unique guest assertion');
 const marker='arena_end_offset(0, 0, 1, 0) != 0';
 assert.equal(source.split(marker).length,2);
 const wrong=await import('data:text/javascript,'+encodeURIComponent(compileProgramV2(source.replace(marker,'arena_end_offset(0, 0, 1, 0) != 1'))));
 assert.equal(wrong.main(),1n);
 console.log('ARENA_POLICY_ESM_ASSERTIONS=56');
});
