import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compile,compileToIR} from '../src/compiler.mjs';

// Exact source bytes from atto-platform-conformance 9a8391ddc4270fd6e1c2a6b1650eff935eb82999.
// Six positive language targets are unsupported; their rejection is NOT parity.
const fixtures = [
  {
    "id": "counted-three",
    "sha": "6531efa0689f2a5728b40a6412651e8143e45865",
    "mode": "run",
    "source": "suspends fnc main(): int { val Channel<int> incoming = Channel.new<int>(4); writech incoming, 3; writech incoming, 5; writech incoming, 13; writech incoming, 99; val Array[int] values = await select<int>(3) over when readch incoming: int value -> { return value * 2; } end; if values[0] == 6 && values[1] == 10 && values[2] == 26 then return readch incoming - 57; fi return 0; }\n"
  },
  {
    "id": "counted-zero",
    "sha": "42e49fc1eea64b31e86ec722e1457c1ab706a7e1",
    "mode": "run",
    "source": "suspends fnc main(): int { val Channel<int> incoming = Channel.new<int>(4); writech incoming, 42; val Array[int] values = await select<int>(0) { when readch incoming: int value -> { return value * 2; } }; return readch incoming; }\n"
  },
  {
    "id": "counted-one",
    "sha": "910062ebf96613d15a16ddb080abd89375d7709c",
    "mode": "run",
    "source": "suspends fnc main(): int { val Channel<int> incoming = Channel.new<int>(4); writech incoming, 21; val Array[int] values = await select(1) { when readch incoming: int value -> { return value * 2; } }; return values[0]; }\n"
  },
  {
    "id": "counted-alias",
    "sha": "324837078af3e7eeb9b619d0fb07142f0a0d6291",
    "mode": "run",
    "source": "suspends fnc main(): int { val Channel<int> incoming = Channel.new<int>(4); writech incoming, 21; val Future<Array<int>> values = nb select<int>(1) over when readch incoming: int value -> { return value * 2; } end; val Array[int] result = await values; return result[0]; }\n"
  },
  {
    "id": "reject-counted-negative",
    "sha": "e2ff6fdb406b8807b74fa15beaee10a7f9438e22",
    "mode": "reject",
    "source": "suspends fnc main(): int { val Channel<int> incoming = Channel.new<int>(4); val Array[int] values = await select<int>(-1) { when readch incoming: int value -> { return value * 2; } }; return 0; }\n"
  },
  {
    "id": "reject-counted-bool",
    "sha": "4a52c22442bc8a9fe55eb95b23722595db32c97e",
    "mode": "reject",
    "source": "suspends fnc main(): int { val Channel<int> incoming = Channel.new<int>(4); val Array[int] values = await select<int>(true) { when readch incoming: int value -> { return value * 2; } }; return 0; }\n"
  },
  {
    "id": "reject-counted-scalar",
    "sha": "a2a2dd184237f17b5e8d455f498719ef1ed01d97",
    "mode": "reject",
    "source": "suspends fnc main(): int { val Channel<int> incoming = Channel.new<int>(4); val int result = await select<int>(1) { when readch incoming: int value -> { return value * 2; } }; return result; }\n"
  },
  {
    "id": "reject-counted-default",
    "sha": "0c67c1fc8eaf55df6abb2b0fe7d2ce80f169bc69",
    "mode": "reject",
    "source": "suspends fnc main(): int { val Array[int] result = await select<int>(3) { default: -> { return 42; } }; return 0; }\n"
  },
  {
    "id": "reject-counted-write",
    "sha": "63fa3c9add56f3793e6d755f006cd3568acf1f04",
    "mode": "reject",
    "source": "suspends fnc main(): int { val Channel<int> incoming = Channel.new<int>(4); val Array[int] result = await select<int>(3) { when writech incoming, 42: -> { return 42; } }; return 0; }\n"
  },
  {
    "id": "counted-dynamic",
    "sha": "7c9ea9270d766612de0d502147e0df31b0dc3454",
    "mode": "run",
    "source": "suspends fnc main(): int { val Channel<int> incoming = Channel.new<int>(4); writech incoming, 3; writech incoming, 5; writech incoming, 13; writech incoming, 99; let int count = 3; val Future<Array<int>> pending = select<int>(count) over when readch incoming: int value -> { return value * 2; } end; count = 1; val Array[int] values = await pending; if values[0] == 6 && values[1] == 10 && values[2] == 26 then return readch incoming - 57; fi return 0; }\n"
  },
  {
    "id": "counted-dynamic-zero",
    "sha": "4707b13d3daebe05ced967418ba120cf801e2d8c",
    "mode": "run",
    "source": "suspends fnc main(): int { val Channel<int> incoming = Channel.new<int>(1); writech incoming, 42; val int count = 0; val Future<Array<int>> pending = select<int>(count) { when readch incoming: int value -> { return value * 2; } }; val Array[int] values = await pending; if values.size == 0 then return readch incoming; fi return 0; }\n"
  },
  {
    "id": "reject-counted-dynamic-bool",
    "sha": "36cd372a5385e34f2e3bd8dd936e4e0491052633",
    "mode": "reject",
    "source": "suspends fnc main(): int { val Channel<int> incoming = Channel.new<int>(1); val bool count = true; val Array[int] values = await select<int>(count) { when readch incoming: int value -> { return value; } }; return 0; }\n"
  },
  {
    "id": "reject-counted-dynamic-unknown",
    "sha": "0e61da7a98987ed5a182148538b35b8a890abf26",
    "mode": "reject",
    "source": "suspends fnc main(): int { val Channel<int> incoming = Channel.new<int>(1); val Array[int] values = await select<int>(missing) { when readch incoming: int value -> { return value; } }; return 0; }\n"
  }
];
test('all thirteen pinned counted source fixtures fail closed in both JS compiler entrypoints',()=>{
  assert.equal(fixtures.length,13);
  assert.equal(fixtures.filter(f=>f.mode==='run').length,6);
  assert.equal(new Set(fixtures.map(f=>f.id)).size,13);
  for(const f of fixtures){
    const raw=Buffer.from(f.source,'utf8');
    assert.equal(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),f.sha,f.id);
    for(const compiler of [compile,compileToIR]){
      assert.throws(()=>compiler(f.source),undefined,f.id+' unexpectedly emitted compiler output');
    }
  }
});
test('isolated variable count headers cannot emit a JS or IR artifact',()=>{
  for(const prefix of ['select','nb select','await select','await nb select'])
    for(const header of ['(count)','<int>(count)'])
      for(const body of ['{ default: -> { return 42; } }','over default: -> { return 42; } end']){
        const source='pub fnc main(): int { val int count = 3; return '+prefix+header+' '+body+'; }';
        for(const compiler of [compile,compileToIR])
          assert.throws(()=>compiler(source),/static select requires checked Channel\/Future arbitration/,source);
      }
});
