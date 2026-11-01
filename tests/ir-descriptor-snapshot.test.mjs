import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIR,compileIR} from '../src/compiler.mjs';
import {compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

// Property-descriptor validation must not be followed by fresh reads of the
// original object. A stateful Proxy may return an entirely different operator,
// numeric target or array element from its get trap.
const poison = (value, replacement) => {
  let reads = 0;
  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      if (Object.hasOwn(replacement, key)) {
        reads++;
        return replacement[key];
      }
      return Reflect.get(target, key, receiver);
    }
  });
  return {proxy, reads: () => reads};
};
const execute = async code =>
  import('data:text/javascript;charset=utf-8,' + encodeURIComponent(code));

test('scalar IR operator and function header use admitted descriptors only', async () => {
  const good = compileToIR('pub fnc main(): int {return 40+2;}');
  const body = poison(good.functions[0].body, {
    op: '+(globalThis.__ores_ir_injection=1)+'
  });
  const header = poison({...good.functions[0], body: body.proxy}, {
    name: 'other', pub: false
  });
  const list = poison([header.proxy], {0: {name: 'bad'}, length: 9999999});
  const untrusted = {...good, functions: list.proxy};
  const js = compileIR(untrusted);
  assert.equal(js, compileIR(good));
  assert.doesNotMatch(js, /__ores_ir_injection/);
  assert.equal((await execute(js)).main(), 42n);
  assert.equal(body.reads(), 0);
  assert.equal(header.reads(), 0);
  assert.equal(list.reads(), 0);
});

test('scalar call target and argument array never change after admission', async () => {
  const good = compileToIR([
    'pub fnc main(): int {return identity(42);}',
    'fnc identity(int x): int {return x;}'
  ].join('\n'));
  const call = good.functions[0].body;
  const args = poison(call.args, {0: {kind: 'int', value: '0'}, length: 9999999});
  const node = poison({...call, args: args.proxy}, {
    target: 999, args: [{kind: 'eval', source: 'process.exit(1)'}]
  });
  const changed = {...good, functions: [{...good.functions[0], body: node.proxy}, good.functions[1]]};
  const js = compileIR(changed);
  assert.equal(js, compileIR(good));
  assert.equal((await execute(js)).main(), 42n);
  assert.equal(node.reads(), 0);
  assert.equal(args.reads(), 0);
});

test('program-v2 IR checked arithmetic operator is snapshotted before ESM emission', async () => {
  const good = compileToProgramIRV2('pub fnc main():int{return 40+2;}');
  const node = poison(good.functions[0].body, {
    op: '+(globalThis.__ores_ir_injection=1)+'
  });
  const changed = {...good, functions: [{...good.functions[0], body: node.proxy}]};
  const js = compileProgramIRV2(changed);
  assert.equal(js, compileProgramIRV2(good));
  assert.doesNotMatch(js, /__ores_ir_injection/);
  assert.equal((await execute(js)).main(), 42n);
  assert.equal(node.reads(), 0);
});

test('program-v2 class method body and call target are descriptor-bound', async () => {
  const good = compileToProgramIRV2([
    'pub define class Box as pub pick(self,int x):int{return x+2;} end',
    'pub fnc main():int{return new Box().pick(40);}'
  ].join('\n'));
  const method = good.classes[0].methods[0];
  const body = poison(method.body, {op: '*(globalThis.__ores_ir_injection=1)*'});
  const call = poison(good.functions[0].body, {classIndex: 999, methodIndex: 999});
  const changed = {
    ...good,
    classes: [{...good.classes[0], methods: [{...method, body: body.proxy}]}],
    functions: [{...good.functions[0], body: call.proxy}]
  };
  const js = compileProgramIRV2(changed);
  assert.equal(js, compileProgramIRV2(good));
  assert.doesNotMatch(js, /__ores_ir_injection/);
  assert.equal((await execute(js)).main(), 42n);
  assert.equal(body.reads(), 0);
  assert.equal(call.reads(), 0);
});

test('real accessors and unsupported fields remain rejected', () => {
  const scalar = compileToIR('pub fnc main():int{return 42;}');
  const operand = {kind: 'int'};
  Object.defineProperty(operand, 'value', {get() {throw Error('getter executed');}});
  assert.throws(() => compileIR({
    ...scalar, functions: [{...scalar.functions[0], body: operand}]
  }), /scalar IR: .*accessor/);
  const program = compileToProgramIRV2('pub fnc main():int{return 42;}');
  const invalid = {...program.functions[0].body, emittedJS: 'process.exit(1)'};
  assert.throws(() => compileProgramIRV2({
    ...program, functions: [{...program.functions[0], body: invalid}]
  }), /program IR: .*missing\/extra fields/);
});
