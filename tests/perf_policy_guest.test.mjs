import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFreestandingCore} from '../src/freestanding-core.mjs';

// Compiled .atto guest-value tests, not a substitute for strict native AOT.
// The program-v2 closed-world JavaScript backend rejects hosted effects.
const load=async()=>{
  const source=await readFile(new URL('../core/perf_policy.atto',import.meta.url),'utf8');
  const esm=compileFreestandingCore(source);
  assert.doesNotMatch(esm,/^\s*import\s/m);
  const runtime=await import('data:text/javascript,'+encodeURIComponent(esm));
  return runtime.core;
};
test('pure .atto core perf policy is linked into a closed JS guest module',async()=>{
  const core=await load();
  assert.equal(Object.getPrototypeOf(core),null);
  assert.ok(Object.isFrozen(core));
  assert.deepEqual(Object.keys(core).sort(),
    ['perf_can_record','perf_duration_ns','perf_next_dropped','perf_should_sample','perf_valid_probe'].sort());
});
test('sampling covers 64-bit boundaries and rejects zero divisors',async()=>{
  const core=await load();
  for(let divisor=1n;divisor<=64n;divisor++){
    for(let n=0n;n<=500n;n++)
      assert.equal(core.perf_should_sample(n,divisor),n%divisor===0n,`n=${n} d=${divisor}`);
  }
  for(const [key,divisor] of [[-1n,1n],[0n,0n],[2n,-2n],[0n,65537n]])
    assert.equal(core.perf_should_sample(key,divisor),false);
  const max=(1n<<63n)-1n;
  assert.equal(core.perf_should_sample(max,1n),true);
  assert.equal(core.perf_should_sample(max,2n),false);
  assert.equal(core.perf_should_sample(max,65536n),false);
});
test('elapsed and capacity guards handle overflow boundaries without wrapping',async()=>{
  const core=await load(),max=(1n<<63n)-1n;
  assert.equal(core.perf_duration_ns(0n,500n),0n);
  assert.equal(core.perf_duration_ns(100n,99n),0n);
  assert.equal(core.perf_duration_ns(100n,100n),0n);
  assert.equal(core.perf_duration_ns(1n,max),max-1n);
  assert.equal(core.perf_can_record(true,0n,1n),true);
  assert.equal(core.perf_can_record(true,1n,1n),false);
  assert.equal(core.perf_can_record(true,65535n,65536n),true);
  assert.equal(core.perf_can_record(true,65536n,65536n),false);
  assert.equal(core.perf_can_record(false,0n,65536n),false);
  assert.equal(core.perf_can_record(true,0n,65537n),false);
});
test('drop saturation and probe admission reject malformed numeric IDs',async()=>{
 const core=await load();
 for(const [n,want] of [[-1n,0n],[0n,1n],[2147483646n,2147483647n],[2147483647n,2147483647n],[9999999999n,2147483647n]])
   assert.equal(core.perf_next_dropped(n),want);
 for(const p of [-1n,0n,2147483648n])
   assert.equal(core.perf_valid_probe(p),false);
 for(const p of [1n,23n,29n,2147483647n])
   assert.equal(core.perf_valid_probe(p),true);
});
test('host calls and source compiler/effect injection are rejected',async()=>{
 const src=await readFile(new URL('../core/perf_policy.atto',import.meta.url),'utf8');
 for(const evil of [
  src.replace('return finished_ns - started_ns;', 'return process.monotonic_ns();'),
  src.replace('return dropped + 1;', 'return stdio.println("leak");'),
  src.replace('return dropped + 1;', 'return eval("1");')
 ])assert.throws(()=>compileFreestandingCore(evil),/error:/);
});
