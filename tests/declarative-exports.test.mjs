import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToProgramIRV2, compileProgramV2 } from '../src/program-v2.mjs';
import { compile as compileScalar } from '../src/compiler.mjs';

const declarations = `define class Foo as
end
define class Bar as
end
fnc compute(): int { return 42; }
`;
const directives = `export pub Foo;
export pub[pkg] class Bar;
export pub fnc compute;
`;

test('program-v2 honors forward and trailing class/fnc exports', async () => {
  const top = compileToProgramIRV2(directives + declarations);
  const bottom = compileToProgramIRV2(declarations + directives);
  assert.deepEqual(top, bottom);
  assert.deepEqual(top.fileExports, [
    { name: 'Foo', kind: 'class', visibility: 'public' },
    { name: 'Bar', kind: 'class', visibility: 'package' },
    { name: 'compute', kind: 'fnc', visibility: 'public' }
  ]);
  const js = compileProgramV2(directives + declarations);
  const m = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(js));
  assert.equal(m.compute(), 42n);
  assert.ok(m.Foo);
  assert.equal(Object.hasOwn(m, 'Bar'), false, 'pub[pkg] must not become a host ESM export');
});

test('scalar compiler resolves exported fnc after collecting declarations', async () => {
  const source = 'fnc compute(): int { return 42; }';
  const top = compileScalar('export pub fnc compute;\n' + source);
  const bottom = compileScalar(source + '\nexport pub compute;');
  assert.equal(top, bottom);
  const m = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(top));
  assert.equal(m.compute(), 42n);
  const scoped = compileScalar('export pub[pkg] fnc compute;\n' + source);
  assert.doesNotMatch(scoped, /export \\{/);
});

test('export directives reject bad symbols, visibility and kinds', () => {
  const cases = [
    'export pub Missing;\n' + declarations,
    'export pub fnc Foo;\n' + declarations,
    'export pub Foo; export pub class Foo;\n' + declarations,
    'export pub[other] Foo;\n' + declarations,
    'export pub[pkg] class Foo; pub define class Foo as end'
  ];
  for (const source of cases) assert.throws(() => compileProgramV2(source), undefined, source);
});
