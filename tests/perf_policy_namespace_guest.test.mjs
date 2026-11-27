import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFreestandingCore} from '../src/freestanding-core.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';

const source=async()=>({
  core:await readFile(new URL('../core/perf_policy.atto',import.meta.url),'utf8'),
  namespace:await readFile(new URL('../core/perf_policy_namespace.atto',import.meta.url),'utf8')
});
const load=code=>import('data:text/javascript,'+encodeURIComponent(code));
const symbols=['perf_can_record','perf_duration_ns','perf_next_dropped',
  'perf_should_sample','perf_valid_probe'];

test('namespace form is body-identical to the backend-owned core module',async()=>{
  const {core,namespace:ns}=await source();
  const moduleMarker='define module core as',namespaceMarker='namespace perf;';
  assert.ok(core.includes(moduleMarker)&&ns.includes(namespaceMarker));
  const left=core.slice(core.indexOf(moduleMarker)+moduleMarker.length)
    .replace(/\s*end\s*$/,'').trim();
  const right=ns.slice(ns.indexOf(namespaceMarker)+namespaceMarker.length).trim();
  assert.equal(right,left,'namespace source diverges from pure Atto module functions');
});

test('actual Atto namespace source compiles to standalone ESM with direct pure exports',async()=>{
  const {core,namespace:ns}=await source();
  const compiled=compileProgramV2(ns);
  const namespaced=await load(compiled);
  const modular=await load(compileFreestandingCore(core));
  assert.deepEqual(Object.keys(namespaced).sort(),symbols.slice().sort());
  assert.equal(Object.hasOwn(namespaced,'perf'),false,
    'namespace metadata must not become a runtime authority');
  assert.deepEqual(Object.keys(modular.core).sort(),symbols.slice().sort());
  for(const [key,divisor] of [[0n,1n],[42n,7n],[43n,7n],
        [-1n,1n],[0n,0n],[(1n<<63n)-1n,65536n]]){
    assert.equal(namespaced.perf_should_sample(key,divisor),
      modular.core.perf_should_sample(key,divisor));
  }
  for(const [start,stop] of [[0n,42n],[1n,42n],[42n,0n],[1n,(1n<<63n)-1n]])
    assert.equal(namespaced.perf_duration_ns(start,stop),
      modular.core.perf_duration_ns(start,stop));
  for(const count of [-1n,0n,2147483646n,2147483647n])
    assert.equal(namespaced.perf_next_dropped(count),modular.core.perf_next_dropped(count));
  for(const id of [0n,23n,29n,2147483647n,2147483648n])
    assert.equal(namespaced.perf_valid_probe(id),modular.core.perf_valid_probe(id));
});

test('namespaces cannot import or export host capabilities without an admitted linker',async()=>{
  const {namespace:ns}=await source();
  for(const evil of [
    ns.replace('namespace perf;','namespace perf;\nimport namespace host as h from secrets;'),
    ns.replace('namespace perf;','namespace perf;\nnamespace other;'),
    ns.replace('namespace perf;','namespace perf.tools;'),
    ns.replace('return dropped + 1;','return process.monotonic_ns();')
  ])assert.throws(()=>compileProgramV2(evil),/error: program v2:/);
});
