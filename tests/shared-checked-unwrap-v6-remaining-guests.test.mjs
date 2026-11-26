// Byte-identical remaining v6 canonical guests, from merged conformance 61fbeac64108739e5b6c1ee3ad15eae4122b2775.
// A compile rejection is a failure, never a runtime panic pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const cases = [
  {
    "path": "checked-unwrap.atto",
    "git_blob_sha1": "90c6166041963d1f466bc51f105c66a0a7be15ac",
    "expected": {
      "result": 42
    },
    "source": "fnc optional(bool present): Option<int> {\n  if present do return Some(42); fi\n  return None;\n}\nfnc outcome(bool present): Result<int, String> {\n  if present do return Ok(42); fi\n  return Err(\"original\");\n}\npub fnc main(): int {\n  val Result<int, Error> a = trap! optional(false).unwrap();\n  val Result<int, Error> b = trap! outcome(false).unwrap();\n  val Result<int, Error> c = trap! optional(true).unwrap();\n  val Result<int, Error> d = trap outcome(true).unwrap();\n  val Result<Option<int>, Error> e = trap! optional(false);\n  val Result<int, Error> f = trap! (trap! optional(false).unwrap());\n  guard a.is_err(), b.is_err(), c.is_ok(), d.is_ok(), e.is_ok(), f.is_err() { return 1; }\n  guard c.unwrap() eq 42, d.unwrap() eq 42, e.unwrap().is_none() { return 2; }\n  return 42;\n}\n"
  },
  {
    "path": "inline-task-failure.atto",
    "git_blob_sha1": "446624a894788834550ac7a13a7a76ea5d06444c",
    "expected": {
      "result": 42,
      "stdout": "D"
    },
    "source": "pub fnc main(): int {\n  let int count = 0;\n  val Option<int> missing = None;\n  val Result<int, Error> failure = trap! sync task<int> {\n    count = count + 2;\n    defer stdio.stdout.write(\"D\");\n    val int value = missing.unwrap();\n    count = count + 100;\n    return value;\n  };\n  guard failure.is_err(), count eq 2 { return 1; }\n  return count + 40;\n}\n"
  },
  {
    "path": "short-circuit.atto",
    "git_blob_sha1": "d24442cf7daf1dd86876b418f0cb9e793cbb23c2",
    "expected": {
      "result": 42,
      "stdout": "RR"
    },
    "source": "fnc rhs(): bool {\n  stdio.stdout.write(\"R\");\n  val Option<bool> missing = None;\n  return missing.unwrap();\n}\nfnc conjunction(bool run): bool { return run && rhs(); }\nfnc disjunction(bool skip): bool { return skip || rhs(); }\npub fnc main(): int {\n  val Result<bool, Error> a = trap! conjunction(false);\n  val Result<bool, Error> b = trap! disjunction(true);\n  val Result<bool, Error> c = trap! conjunction(true);\n  val Result<bool, Error> d = trap! disjunction(false);\n  guard a.is_ok(), b.is_ok(), c.is_err(), d.is_err() { return 1; }\n  guard !a.unwrap(), b.unwrap() { return 2; }\n  return 42;\n}\n"
  },
  {
    "path": "terminal-expect.atto",
    "git_blob_sha1": "864e6b34fe46de9c260a7e537f3f008caa7c8b79",
    "expected": {
      "runtime_failure": "uncaught_guest_panic"
    },
    "source": "pub fnc main(): int {\n  val Option<int> missing = None;\n  val Result<int, Error> ignored = trap! missing.expect(\"explicit panic control\");\n  return 101;\n}\n"
  }
];
function blob(source) {
  const bytes=Buffer.from(source,'utf8');
  return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
for (const fixture of cases) {
  test('exact v6 remaining guest '+fixture.path, async () => {
    assert.equal(blob(fixture.source),fixture.git_blob_sha1);
    const ir=compileToProgramIRV2(fixture.source);
    const direct=compileProgramV2(fixture.source);
    const replay=compileProgramIRV2(JSON.parse(JSON.stringify(ir)));
    assert.equal(replay,direct,'serialized typed IR changed lowering');
    if (fixture.expected.runtime_failure) {
      const guest=await import('data:text/javascript,'+encodeURIComponent(direct));
      assert.throws(()=>guest.main(),e=>e?.effect==='panic' && e.message.includes('explicit panic control'));
      return;
    }
    // Child process isolates output and prevents harness output being
    // confused with guest stdout. No source adaptation or injected guest code.
    const runner='const g=await import(process.argv[1]); const value=g.main(); if(value!==42n) process.exitCode=23;';
    const run=spawnSync(process.execPath,['--input-type=module','-e',runner,'data:text/javascript,'+encodeURIComponent(direct)],{encoding:'utf8',timeout:10000,maxBuffer:65536});
    assert.ifError(run.error);
    assert.equal(run.signal,null);
    assert.equal(run.status,0,run.stderr);
    assert.equal(run.stderr,'');
    assert.equal(run.stdout,fixture.expected.stdout??'');
  });
}
