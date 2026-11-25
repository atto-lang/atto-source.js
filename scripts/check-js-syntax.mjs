// Zero-dependency Node syntax gate; no shell, no network, no symlink walking.
import {readdirSync} from 'node:fs';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const files=[];
function scan(dir) {
  for(const ent of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const path=join(dir,ent.name);
    if(ent.isSymbolicLink())throw new Error('E_SYNTAX_CHECK_SYMLINK '+path);
    if(ent.isDirectory())scan(path);
    else if(ent.isFile()&&['.mjs','.js','.cjs'].includes(extname(ent.name)))files.push(path);
    else if(!ent.isFile())throw new Error('E_SYNTAX_CHECK_ENTRY '+path);
    if(files.length>2048)throw new Error('E_SYNTAX_CHECK_LIMIT');
  }
}
for(const dir of ['src','runtime','bin','scripts','tests'])scan(join(root,dir));
if(!files.length)throw new Error('E_SYNTAX_CHECK_NO_FILES');
for(const path of files) {
  const result=spawnSync(process.execPath,['--check',path],{
    cwd:root,encoding:'utf8',timeout:15000,maxBuffer:524288,
    windowsHide:true,env:{...process.env,NODE_OPTIONS:''}
  });
  if(result.error||result.status!==0||result.signal)
    throw new Error('E_JS_SYNTAX_CHECK '+path+' : '+
      String(result.error?.message||result.stderr||result.signal||result.status).slice(0,2048));
}
console.log('Node '+process.version+': syntax checked '+files.length+' files');
