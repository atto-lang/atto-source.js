import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFreestandingCore} from '../src/freestanding-core.mjs';

const moduleFrom = async (relative) => {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const esm = compileFreestandingCore(source);
  assert.doesNotMatch(esm, /^\s*import\b/m);
  const exported = await import('data:text/javascript,' + encodeURIComponent(esm));
  return exported.core;
};

test('Atto source Option<int> keeps Some(0) distinct from None', async () => {
  const option = await moduleFrom('../core/option.atto');
  const zero = option.option_map_add(option.option_if_positive(5n), -5n);
  const none = option.option_if_positive(0n);
  assert.equal(option.option_is_some(zero), true);
  assert.equal(option.option_unwrap_or(zero, 99n), 0n);
  assert.equal(option.option_is_some(none), false);
  assert.equal(option.option_unwrap_or(none, 99n), 99n);
  const good = option.option_to_result(zero, -9n);
  const bad = option.option_to_result(none, -9n);
  assert.equal(good.kind, 'Ok');
  assert.equal(good.value, 0n);
  assert.equal(bad.kind, 'Err');
  assert.equal(bad.value, -9n);
});

test('Atto source Result<int,int> leaves Err untouched when mapping Ok', async () => {
  const result = await moduleFrom('../core/result.atto');
  const ok = result.result_map_add(result.result_ok_if_nonnegative(1n), -1n);
  const err = result.result_map_add(result.result_ok_if_nonnegative(-7n), 50n);
  assert.equal(result.result_is_ok(ok), true);
  assert.equal(result.result_unwrap_or(ok, 99n), 0n);
  assert.equal(result.result_error_or(ok, 99n), 99n);
  assert.equal(result.result_is_ok(err), false);
  assert.equal(result.result_unwrap_or(err, 99n), 99n);
  assert.equal(result.result_error_or(err, 99n), -7n);
  assert.equal(result.result_to_option(ok).kind, 'Some');
  assert.equal(result.result_to_option(err).kind, 'None');
});

test('nominal sum tags, i64 boundaries and host capabilities remain sealed', async () => {
  const option = await moduleFrom('../core/option.atto');
  const result = await moduleFrom('../core/result.atto');
  assert.throws(() => option.option_unwrap_or(result.result_ok_if_nonnegative(2n), 8n), /tagged value type/);
  assert.throws(() => result.result_unwrap_or(option.option_if_positive(2n), 8n), /tagged value type/);
  assert.throws(() => option.option_map_add(option.option_if_positive(1n), 1n << 63n), /OVERFLOW/);
  assert.throws(() => option.option_if_positive(1), /BigInt/);
  for (const source of [
    'define module core as pub fnc leak(): int { return process.exit(0); } end',
    'define module core as pub fnc forged(): Option<int> { return Result.ok(5); } end',
    'define module core as pub fnc bogus(): Option<int> { return Some(true); } end'
  ]) assert.throws(() => compileFreestandingCore(source), /error:/);
});
