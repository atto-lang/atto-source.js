#!/usr/bin/env node
// Explicitly experimental Atto structural subset CLI. Not the full compiler.
import {open,writeFile,link,lstat,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename,dirname,join,resolve,isAbsolute} from 'node:path';
import {randomBytes} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {compileStructuralProjectionIR} from '../src/structural-projection-ir.mjs';
import {compileStructuralProjectionSource} from '../src/structural-source.mjs';
import {compileFunctionalPipelineSource} from '../src/functional-pipelines.mjs';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const MAX_BYTES=262144;
let temp=null;

async function boundedText(path) {
  const before=await lstat(path);
  if(!before.isFile()||before.isSymbolicLink()||before.size>MAX_BYTES)
    throw Error('input must be a bounded non-symlink regular file');
  const flags=constants.O_RDONLY | (constants.O_NOFOLLOW||0) | (constants.O_NONBLOCK||0);
  const file=await open(path,flags);
  try {
    const st=await file.stat();
    if(!st.isFile()||st.size>MAX_BYTES||st.ino!==before.ino||st.dev!==before.dev)
      throw Error('source file changed or exceeds byte limit');
    const chunks=[];let size=0;
    while(size<=MAX_BYTES) {
      const buffer=Buffer.allocUnsafe(Math.min(65536,MAX_BYTES+1-size));
      const {bytesRead}=await file.read(buffer,0,buffer.length,null);
      if(bytesRead===0)break;
      size+=bytesRead;
      if(size>MAX_BYTES)throw Error('input grew beyond byte limit');
      chunks.push(buffer.subarray(0,bytesRead));
    }
    const bytes=Buffer.concat(chunks,size);
    if(bytes.length>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)
      throw Error('UTF-8 BOM not accepted');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  } finally {await file.close();}
}

try {
  const args=process.argv.slice(2);
  const mode=args.shift();
  if(mode!=='--structural-source'&&mode!=='--structural-ir'&&mode!=='--functional-source')
    throw Error('usage: atto-jsc --structural-source|--structural-ir|--functional-source [--portable] [--check] input.atto|input.json [--out=/absolute/output.mjs]');
  const portable=args[0]==='--portable';
  if(portable)args.shift();
  const checkOnly=args[0]==='--check';
  if(checkOnly)args.shift();
  const input=args.shift();
  if(!input||input.startsWith('--')||args.length>1||
     (args.length&&!args[0].startsWith('--out='))||
     (checkOnly&&args.length))
    throw Error('invalid structural CLI input or output arguments');
  if(mode==='--functional-source'&&!input.endsWith('.atto'))
    throw Error('functional source mode requires .atto input');
  const text=await boundedText(resolve(input));
  const result=mode==='--functional-source'
    ?compileFunctionalPipelineSource(text)
    :mode==='--structural-ir'
    ?compileStructuralProjectionIR(parseStrictJsonReport(text,MAX_BYTES,'Atto typed IR'),{portable})
    :compileStructuralProjectionSource(text,{portable});
  if(checkOnly)process.stdout.write('OK\n');
  else if(!args.length)process.stdout.write(result);
  else {
    const outputPath=args[0].slice('--out='.length);
    if(!outputPath||!isAbsolute(outputPath))throw Error('output path must be absolute');
    const dest=resolve(outputPath);
    if(await lstat(dest).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;}))
      throw Error('refusing to replace existing output');
    temp=join(dirname(dest),'.'+basename(dest)+'.'+randomBytes(12).toString('hex')+'.tmp');
    await writeFile(temp,result,{flag:'wx',mode:0o600});
    await link(temp,dest);
    await unlink(temp);
    temp=null;
  }
} catch(error) {
  console.error(error instanceof Error?error.message:String(error));
  process.exitCode=1;
} finally {
  if(temp)await unlink(temp).catch(()=>{});
}
