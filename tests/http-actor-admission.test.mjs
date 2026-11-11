import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm, access, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {compile, compileToIR} from '../src/compiler.mjs';
import {compileProgramV2, compileToProgramIRV2} from '../src/program-v2.mjs';

const frontends = [
  ['scalar-v1', compile, compileToIR],
  ['program-v2', compileProgramV2, compileToProgramIRV2],
];
const unsupported = /HTTP_ACTOR_BACKEND_UNSUPPORTED/;

test('shared .atto 3x4 HTTP actor fixture rejects before scalar or JS IR lowering', async () => {
  const source = await readFile(new URL('./fixtures/http-actor-unsupported.atto', import.meta.url), 'utf8');
  for (const [name, compileSource, frontend] of frontends) {
    assert.throws(() => frontend(source), unsupported, name);
    assert.throws(() => compileSource(source), unsupported, name);
  }
});

test('serial 1x1, 3x4, public and mixed-order source HTTP actors fail closed', () => {
  const forms = [
    'define serial http actor Endpoint as end',
    'define http actor Endpoint as int requestConcurrency = 1; int messageConcurrency = 1; end',
    'define http actor Endpoint as int requestConcurrency = 3; int messageConcurrency = 4; end',
    'define pub shared http actor Endpoint as end',
    'pub define untrusted http actor Endpoint as end',
    'pub define http isoactor Endpoint as end',
    'define private tcp http stream actor Endpoint as end',
  ];
  for (const source of forms) for (const [name, compileSource, frontend] of frontends) {
    assert.throws(() => frontend(source), unsupported, name+' '+source);
    assert.throws(() => compileSource(source), unsupported, name+' '+source);
  }
});

test('quoted/commented lookalikes are lexically inert, and http remains an identifier', () => {
  for (const [, compileSource] of frontends) {
    const source = [
      '/* define http actor Hidden as end */',
      '// define serial http actor Hidden as end',
      'pub fnc http(): int { return 42; }',
      'pub fnc main(): int { return http(); }',
    ].join('\n');
    assert.doesNotThrow(() => compileSource(source));
  }
  // A Symbol literal token is not a declaration keyword; unrelated type
  // errors must not be mislabeled as HTTP actor admission.
  assert.throws(
    () => compileToProgramIRV2('pub fnc main(): int { return #"define http actor"; }'),
    error => !unsupported.test(error.message)
  );
});

test('CLI --check and --out fail closed without creating JavaScript artifacts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atto-http-admission-'));
  try {
    const fixture = await readFile(new URL('./fixtures/http-actor-unsupported.atto', import.meta.url), 'utf8');
    const input = join(dir,'actor.atto');
    await writeFile(input, fixture);
    const cli = resolve('bin/oreslang-jsc.mjs');
    for(const args of [[],['--program-v2']]){
      const denied = spawnSync(process.execPath,[cli,...args,'--check',input],{encoding:'utf8'});
      assert.notEqual(denied.status,0);
      assert.match(denied.stderr,unsupported);
      const output=join(dir,'rejected-'+args.length+'.mjs');
      const deniedBuild = spawnSync(process.execPath,[cli,...args,input,'--out='+output],{encoding:'utf8'});
      assert.notEqual(deniedBuild.status,0);
      assert.match(deniedBuild.stderr,unsupported);
      await assert.rejects(access(output), {code:'ENOENT'});
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
});
