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
  assert.doesNotMatch(scoped, /export \{/);
});

test('export directives reject bad symbols, visibility and kinds', () => {
  const cases = [
    'export pub Missing;\n' + declarations,
    'export pub fnc Foo;\n' + declarations,
    'export pub Foo; export pub[pkg] class Foo;\n' + declarations,
    'export pub Foo; export pub fnc Foo;\n' + declarations,
    'export pub[other] Foo;\n' + declarations,
    'export pub[pkg] class Foo; pub define class Foo as end'
  ];
  for (const source of cases) assert.throws(() => compileProgramV2(source), undefined, source);
});

test('identical resolved exports deduplicate without widening package visibility', async () => {
  for (const compile of [compileProgramV2, compileScalar]) {
    const body='fnc compute(): int { return 42; }';
    for (const [a,b] of [['export pub compute;','export pub fnc compute;'],['export pub fnc compute;','export pub compute;'],['export pub[pkg] compute;','export pub[pkg] fnc compute;']]) {
      const single=compile(a+'\n'+body);
      const repeated=compile(a+'\n'+body+'\n'+b);
      assert.equal(repeated,single);
      const m=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(repeated));
      if(a.includes('[pkg]'))assert.equal(Object.hasOwn(m,'compute'),false);
      else assert.equal(m.compute(),42n);
    }
    for(const [a,b] of [['export pub compute;','export pub[pkg] compute;'],['export pub[pkg] compute;','export pub compute;']])assert.throws(()=>compile(a+'\n'+body+'\n'+b),/conflict/);
  }
  const ir=compileToProgramIRV2('export pub Foo; export pub class Foo;\n'+declarations);
  assert.deepEqual(ir.fileExports,[{name:'Foo',kind:'class',visibility:'public'}]);
});

test('file export cannot escape a scalar module or callable body', () => {
  for(const compile of [compileScalar,compileProgramV2]) {
    for(const src of [
      'define module M as export pub fnc hidden; fnc hidden(): int { return 42; } end',
      'define module M as fnc hidden(): int { return 42; } export pub hidden; end',
      'fnc hidden(): int { return 42; } fnc main(): int { export pub hidden; return hidden(); }'
    ]) assert.throws(()=>compile(src),undefined,src);
  }
});

test('written private declarations are not eligible for file exports', async () => {
  for(const compile of [compileScalar,compileProgramV2]) {
    for(const header of ['private fnc','private define fnc','define private fnc']) {
      const decl=header+' hidden(): int { return 42; }';
      const main='pub fnc main(): int { return hidden(); }';
      const output=compile(decl+'\n'+main);
      const m=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(output));
      assert.equal(m.main(),42n);
      assert.equal(Object.hasOwn(m,'hidden'),false);
      for(const directive of ['export pub hidden;','export pub[pkg] fnc hidden;'])
        for(const src of [directive+'\n'+decl,decl+'\n'+directive])
          assert.throws(()=>compile(src+'\n'+main),/explicit private declaration/);
    }
    assert.throws(()=>compile('private fnc hidden(): int { return 42; } fnc hidden(int x): int { return x; } export pub hidden;'),/explicit private declaration/);
    assert.throws(()=>compile('private pub fnc hidden(): int { return 42; }'),/visibility modifier/);
  }
  for(const decl of ['private define class Hidden as end','define private class Hidden as end']) {
    const output=compileProgramV2(decl+' pub fnc main(): int { return 42; }');
    const m=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(output));
    assert.equal(m.main(),42n);
    assert.equal(Object.hasOwn(m,'Hidden'),false);
    for(const directive of ['export pub Hidden;','export pub[pkg] class Hidden;'])
      for(const source of [directive+'\n'+decl,decl+'\n'+directive])
        assert.throws(()=>compileProgramV2(source),/explicit private declaration/);
  }
});
