#!/usr/bin/env node
import {open, writeFile, link, lstat, unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename, dirname, join, resolve, isAbsolute} from 'node:path';
import {randomBytes} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {compile, check} from '../src/compiler.mjs';
import {compileProgramV2, checkProgramV2} from '../src/program-v2.mjs';

const MAX_SOURCE_BYTES=262144;
async function readSource(path) {
  // The pre-open check rejects symlinks on platforms lacking O_NOFOLLOW.
  // O_NOFOLLOW protects against final-component replacement on supporting hosts.
  const before=await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_SOURCE_BYTES)
    throw Error('input must be a regular non-symlink file <= 262144 bytes');
  const flags=constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0);
  const file=await open(path,flags);
  try {
    const st=await file.stat();
    if (!st.isFile() || st.size > MAX_SOURCE_BYTES ||
        (before.ino !== st.ino || before.dev !== st.dev))
      throw Error('input changed or is not a bounded regular file');
    const chunks=[];let size=0;
    while (size<=MAX_SOURCE_BYTES) {
      const buf=Buffer.allocUnsafe(Math.min(65536,MAX_SOURCE_BYTES+1-size));
      const {bytesRead}=await file.read(buf,0,buf.length,null);
      if (bytesRead===0)break;
      size+=bytesRead;
      if (size>MAX_SOURCE_BYTES)throw Error('input grew beyond 262144 bytes');
      chunks.push(buf.subarray(0,bytesRead));
    }
    // Fatal UTF-8 is essential: invalid bytes inside comments must not be ignored.
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));
  } finally {await file.close();}
}

let temp=null;
try {
  const rawArgs=process.argv.slice(2);
  // Explicit experimental dialect flag. Default scalar-v1 behavior stays stable
  // until cross-backend semantics and host ABI have been independently validated.
  const extended=rawArgs[0]==='--program-v2';
  const args=extended?rawArgs.slice(1):rawArgs;
  const checkOnly=args[0]==='--check';
  const input=checkOnly?args[1]:args[0];
  const extras=args.slice(checkOnly?2:1);
  if (!input || input.startsWith('--') || extras.length>1 ||
      (extras.length && !extras[0].startsWith('--out=')))
    throw Error('usage: oreslang-jsc [--program-v2] [--check] input.ores [--out=/absolute/output.mjs]');
  if (checkOnly && extras.length) throw Error('--check does not accept --out');
  const source=await readSource(resolve(input));
  if (checkOnly) {
    if (extended) checkProgramV2(source); else check(source);
    process.stdout.write('OK\n');
  } else {
    const output=extended?compileProgramV2(source):compile(source);
    if (!extras.length) process.stdout.write(output);
    else {
      const outputPath=extras[0].slice('--out='.length);
      if (!outputPath || !isAbsolute(outputPath))
        throw Error('--out requires an absolute destination path');
      const dest=resolve(outputPath);
      if (await lstat(dest).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;}))
        throw Error('refusing to replace existing output');
      temp=join(dirname(dest),'.'+basename(dest)+'.'+randomBytes(12).toString('hex')+'.tmp');
      await writeFile(temp,output,{flag:'wx',mode:0o600});
      // Publish without replacing an existing destination, including race writers.
      await link(temp,dest);
      await unlink(temp);
      temp=null;
    }
  }
} catch(e) {
  console.error(e instanceof Error?e.message:String(e));
  process.exitCode=1;
} finally {
  if(temp)await unlink(temp).catch(()=>{});
}
