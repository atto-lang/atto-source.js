import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const expected=['test:atto-canonical','test:conditionals','test:conditional-adt',
  'test:named-args','test:symbols','test:symbol-wire','test:program-classes',
  'test:class-methods','check','parity:js','parity:numeric-js'];
function workflowCommands() {
  const folder=join(root,'.github/workflows');
  return readdirSync(folder).filter(p=>/\.ya?ml$/.test(p)).flatMap(name=>
    [...readFileSync(join(folder,name),'utf8')
      .matchAll(/\bnpm\s+run\s+([a-zA-Z0-9_][a-zA-Z0-9_.:-]*)/g)]
      .map(match=>({name,command:match[1]})));
}
test('all workflow npm-run commands have registered package scripts',()=>{
  const commands=workflowCommands();
  assert.ok(commands.length>=expected.length,'no run commands found');
  for(const {name,command} of commands)
    assert.ok(Object.hasOwn(manifest.scripts,command),name+': '+command);
  for(const name of expected)
    assert.ok(commands.some(x=>x.command===name),'missing required workflow gate '+name);
});
test('named conformance commands execute existing test files',()=>{
  for(const name of expected.filter(x=>x.startsWith('test:')||x.startsWith('parity:'))) {
    const cmd=manifest.scripts[name];
    assert.match(cmd,/^node --test (?:tests\/[a-zA-Z0-9_-]+\.test\.mjs ?)+$/);
    const selected=cmd.match(/tests\/[a-zA-Z0-9_-]+\.test\.mjs/g)||[];
    assert.ok(selected.length>0,name);
    for(const path of selected)
      assert.ok(existsSync(join(root,path)),name+': '+path);
  }
});
test('check command is an existing Node-only syntax gate',()=>{
  assert.equal(manifest.scripts.check,'node scripts/check-js-syntax.mjs');
  assert.ok(existsSync(join(root,'scripts/check-js-syntax.mjs')));
});
test('the missing-script detector fails on a synthetic removed command',()=>{
  const broken={...manifest.scripts};
  delete broken['test:conditionals'];
  assert.ok(workflowCommands().some(c=>!Object.hasOwn(broken,c.command)));
});
