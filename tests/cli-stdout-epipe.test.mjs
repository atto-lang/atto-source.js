import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../bin/oreslang-jsc.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/arithmetic.ores', import.meta.url));

function runCli({closeStdout = false} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--check', fixture], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let diagnostic = '';
    child.on('error', reject);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { diagnostic += data; });
    // The compiler performs async source loading before its first output.
    // Closing the read side immediately causes a real OS pipe failure.
    if (closeStdout) child.stdout.destroy();
    child.on('close', (code, signal) => resolve({code, signal, output, diagnostic}));
  });
}

test('CLI --check reports OK after acknowledged stdout write', async () => {
  const result = await runCli();
  assert.equal(result.code, 0, result.diagnostic);
  assert.equal(result.signal, null);
  assert.equal(result.output, 'OK\\n');
  assert.equal(result.diagnostic, '');
});

test('CLI turns broken stdout pipe into a controlled failure, not an uncaught event', async () => {
  const result = await runCli({closeStdout: true});
  assert.equal(result.code, 1, result.diagnostic);
  assert.equal(result.signal, null);
  assert.match(result.diagnostic, /EPIPE|broken pipe|ERR_STREAM_DESTROYED/);
  assert.doesNotMatch(result.diagnostic, /Unhandled 'error' event|Emitted 'error' event on|node:events:/);
});
