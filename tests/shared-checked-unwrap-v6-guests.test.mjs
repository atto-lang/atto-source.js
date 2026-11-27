// Exact shared conformance #635 integrated candidate 2be1230ee6bad2017fc0dfab8777c01643a265f1.
// No grammar rewrites, host-calculated answers, or skip-as-pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

const fixtures = [
  {
    "name": "piped-match-none",
    "blob": "fb1653c04f6556e130ec0dc51f8a0fd933e34580",
    "source": "declare type Bounded = int where self >= 1 and self <= 42;\n\npub fnc main() -> int {\n    val Option<int> x = None;\n\n    return trap! x.unwrap() |> match<int>  over\n        on Ok(n): int -> n,\n        on Err(): int -> 42,\n    end;\n}\n"
  },
  {
    "name": "piped-match-some",
    "blob": "77b3f981f031aaaef072f1c68b66960825cf232c",
    "source": "declare type Bounded = int where self >= 1 and self <= 42;\n\npub fnc main() -> int {\n    val Option<int> x = Some(42);\n\n    return trap! x.unwrap() |> match<int>  over\n        on Ok(n): int -> n,\n        on Err(): int -> 7,\n    end;\n}\n"
  },
  {
    "name": "piped-match-dynamic",
    "blob": "99cf8ea1bf165b622c65400244a684ae0153fcb9",
    "source": "declare type Bounded = int where self >= 1 and self <= 42;\n\nfnc get_value(bool present): Option<int> {\n    return present ? Some(7) : None;\n}\n\nfnc choose(bool present): int {\n    val Option<int> x = get_value(present);\n    return trap! x.unwrap() |> match<int> over\n        on Ok(n): int -> n,\n        on Err(): int -> 42,\n    end;\n}\n\npub fnc main(): int {\n    guard choose(true) eq 7 { return 1; }\n    guard choose(false) eq 42 { return 2; }\n    return 42;\n}\n"
  },
  {
    "name": "piped-match-arm-throw",
    "blob": "411801dc7eb4f6e3065911012ba21f3ffc8227c4",
    "source": "fnc downstream_failure(): int throws(Error) {\n    throw! new Error(\"downstream\");\n}\n\nfnc choose(Option<int> x): int throws(Error) {\n    return trap! x.unwrap() |> match<int> over\n        on Ok(n): int -> n,\n        on Err(): int -> downstream_failure(),\n    end;\n}\n\npub fnc main(): int {\n    guard choose(Some(7)) eq 7 { return 1; }\n    val caught = trap! choose(None);\n    guard caught.is_err() { return 2; }\n    return 42;\n}\n"
  },
  {
    "name": "piped-match-error-binding",
    "blob": "13ee1d7cd4b83e062c4f8b454d2b5b213cc24a8f",
    "source": "fnc handle_error(Error e): int throws() {\n    return 42;\n}\n\nfnc choose(Option<int> x): int throws() {\n    return trap! x.unwrap() |> match<int> over\n        on Ok(n): int -> n,\n        on Err(e): int -> handle_error(e),\n    end;\n}\n\npub fnc main(): int throws() {\n    guard choose(Some(7)) eq 7 { return 1; }\n    guard choose(None) eq 42 { return 2; }\n    return 42;\n}\n"
  }
];

function gitBlob(source) {
  const bytes = Buffer.from(source, 'utf8');
  return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
for (const {name,blob,source} of fixtures) {
  test('shared v6 exact JS guest '+name, async () => {
    assert.equal(gitBlob(source),blob);
    const ir = compileToProgramIRV2(source);
    const direct = compileProgramV2(source);
    const roundtrip = compileProgramIRV2(JSON.parse(JSON.stringify(ir)));
    assert.equal(roundtrip,direct,'serialized typed IR changed lowering');
    const guest = await import('data:text/javascript,'+encodeURIComponent(direct));
    assert.equal(guest.main(),42n);
  });
}
