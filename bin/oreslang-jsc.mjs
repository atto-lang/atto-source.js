#!/usr/bin/env node
import {readFile, writeFile, rename, lstat, unlink} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {compile, check} from '../src/compiler.mjs';

let temp = null;
try {
  const args = process.argv.slice(2);
  const checkOnly = args[0] === '--check';
  const input = checkOnly ? args[1] : args[0];
  const extras = args.slice(checkOnly ? 2 : 1);
  if (!input || extras.length > 1 || (extras.length && !extras[0].startsWith('--out=')))
    throw Error('usage: oreslang-jsc [--check] input.ores [--out=/absolute/output.mjs]');
  if (checkOnly && extras.length) throw Error('--check does not accept --out');
  const filename = resolve(input);
  const st = await lstat(filename);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 256 * 1024)
    throw Error('input must be a regular non-symlink file <= 262144 bytes');
  const source = await readFile(filename, 'utf8');
  if (checkOnly) { check(source); process.stdout.write('OK\n'); }
  else {
    const output = compile(source);
    if (!extras.length) process.stdout.write(output);
    else {
      const dest = resolve(extras[0].slice('--out='.length));
      if (await lstat(dest).then(()=>true).catch(e=>{if(e.code==='ENOENT') return false; throw e;}))
        throw Error('refusing to replace existing output');
      temp = join(dirname(dest), '.'+basename(dest)+'.'+randomBytes(12).toString('hex')+'.tmp');
      await writeFile(temp, output, {flag:'wx',mode:0o600});
      await rename(temp,dest);
      temp = null;
    }
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  if (temp) await unlink(temp).catch(()=>{});
}
