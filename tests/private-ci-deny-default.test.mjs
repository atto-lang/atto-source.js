import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,symlinkSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const workflow=readFileSync(new URL('../.github/workflows/private-ci-policy.yml', import.meta.url),'utf8');
const needle='      - name: Require private source export to remain disabled\\n        shell: bash\\n        run: |\\n';
const pos=workflow.indexOf(needle.replaceAll('\\n','\n'));
assert.ok(pos>=0,'required private source denial step exists');
const lines=workflow.slice(pos+needle.replaceAll('\\n','\n').length).split('\n');
const script=lines.filter(line=>line.startsWith('          ') || line.trim()==='')
  .map(line=>line.startsWith('          ')?line.slice(10):'').join('\n');

test('private source denial shell is syntactically valid',()=>{
  const result=spawnSync('bash',['-n'],{input:script,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
function execute(contents,{symlink=false}={}){
 const root=mkdtempSync(join(tmpdir(),'atto-private-ci-deny-'));
 try{
  mkdirSync(join(root,'.github'));
  const path=join(root,'.github','private-ci-approved-repositories.txt');
  if(symlink){
    writeFileSync(join(root,'destination.txt'),contents);
    symlinkSync('../destination.txt',path);
  }else writeFileSync(path,contents);
  return spawnSync('bash',['-c',script],{cwd:root,encoding:'utf8'});
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('comment-only allowlist passes but does not approve any carrier',()=>{
 const result=execute('# No repositories approved.\\n  # Comment\\n\\n'.replaceAll('\\n','\n'));
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/disabled by default/);
});
test('active destination remains forbidden',()=>{
 for(const input of ['org/private 1234\n','  org/private 1234\n','  # valid comment\norg/private 1234\n']){
  const result=execute(input);
  assert.notEqual(result.status,0,input);
  assert.match(result.stderr,/PRIVATE_CI_EXPORT_REJECTED/);
 }
});
test('symlinks and oversize allowlists are denied',()=>{
 assert.notEqual(execute('# comment\n',{symlink:true}).status,0);
 assert.notEqual(execute('#'.padEnd(65537,'x')+'\n').status,0);
});
