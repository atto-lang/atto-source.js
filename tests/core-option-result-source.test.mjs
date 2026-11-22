import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFreestandingCore} from '../src/freestanding-core.mjs';

const moduleFrom = async (relative) => {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const esm = compileFreestandingCore(source);
  assert.doesNotMatch(esm, /^\s*import\b/m);
  const exported = await import('data:text/javascript,' + encodeURIComponent(esm));
  // Namespace functions export as bare public ESM names; legacy module
  // sources retain the .core export. Neither path grants ambient host imports.
  return exported.core ?? exported;
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

test('bounded scalar domain agrees with nominal Option and Result truth tables', async () => {
  const option = await moduleFrom('../core/option.atto');
  const result = await moduleFrom('../core/result.atto');
  for (let value = -128n; value <= 128n; value++) {
    const maybe = option.option_if_positive(value);
    const mapped = option.option_map_add(maybe, 7n);
    assert.equal(mapped.kind, value > 0n ? 'Some' : 'None');
    assert.equal(option.option_unwrap_or(mapped, 91n), value > 0n ? value + 7n : 91n);
    const converted = option.option_to_result(maybe, -18n);
    assert.equal(converted.kind, value > 0n ? 'Ok' : 'Err');
    assert.equal(converted.value, value > 0n ? value : -18n);

    const checked = result.result_ok_if_nonnegative(value);
    const shifted = result.result_map_add(checked, -3n);
    assert.equal(shifted.kind, value >= 0n ? 'Ok' : 'Err');
    assert.equal(shifted.value, value >= 0n ? value - 3n : value);
    assert.equal(result.result_unwrap_or(shifted, 90n), value >= 0n ? value - 3n : 90n);
    assert.equal(result.result_error_or(shifted, 90n), value < 0n ? value : 90n);
    assert.equal(result.result_to_option(checked).kind, value >= 0n ? 'Some' : 'None');
  }
});

test('every constructed sum is a sealed data-only ABI value', async () => {
  const option = await moduleFrom('../core/option.atto');
  const result = await moduleFrom('../core/result.atto');
  const values = [
    option.option_if_positive(1n),
    option.option_if_positive(-1n),
    result.result_ok_if_nonnegative(0n),
    result.result_ok_if_nonnegative(-1n),
    option.option_map_add(option.option_if_positive(1n), 7n),
    result.result_map_add(result.result_ok_if_nonnegative(-1n), 7n)
  ];
  for (const item of values) {
    assert.equal(Object.getPrototypeOf(item), null);
    assert.equal(Object.isFrozen(item), true);
    assert.deepEqual(Reflect.ownKeys(item).sort(), ['kind', 'value']);
    assert.equal(typeof item.kind, 'string');
    assert.equal(item.kind === 'None' ? item.value === null : typeof item.value === 'bigint', true);
  }
  const poison = Object.freeze(Object.defineProperties(Object.create(null), {
    kind: {value: 'Some', enumerable: true},
    value: {get() { throw Error('poison must not execute'); }, enumerable: true}
  }));
  assert.throws(() => option.option_map_add(poison, 2n), /TypeError|tagged value/);
  const badErr = Object.freeze(Object.assign(Object.create(null), {
    kind: 'Err', value: 1n, extra: 1n
  }));
  assert.throws(() => result.result_map_add(badErr, 2n), /TypeError|tagged value/);
});

test('freestanding namespace admission is strict and does not widen module privileges', async () => {
  const optionSource = await readFile(new URL('../core/option.atto', import.meta.url), 'utf8');
  const resultSource = await readFile(new URL('../core/result.atto', import.meta.url), 'utf8');
  assert.match(optionSource, /\bnamespace core;/);
  assert.match(resultSource, /\bnamespace core;/);
  for (const source of [optionSource, resultSource]) {
    const esm = compileFreestandingCore(source);
    assert.doesNotMatch(esm, /^\s*import\b/m);
    assert.doesNotMatch(esm, /export \{ [^\n]+ as "core"/);
  }
  for (const source of [
    'namespace std; pub fnc leak(): int { return 42; }',
    'namespace core; define module core as pub fnc f(): int { return 42; } end',
    'namespace core; pub fnc leak(): int { return process.exit(0); }',
    'namespace core; pub fnc wrong(): Option<int> { return Err(5); }',
    'namespace core; pub fnc wrong(): Result<int,int> { return Some(5); }',
    'namespace core; define class Host as end pub fnc f(): int { return 42; }'
  ]) assert.throws(() => compileFreestandingCore(source), /error:/);
});
