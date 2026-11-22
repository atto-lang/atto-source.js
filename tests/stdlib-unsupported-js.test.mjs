// Compiler-backed capability admission: NOT stdlib guest-execution parity.
// The JS Atto scalar compiler currently does not support file imports,
// braced multi-statement control flow or bool-valued protocol APIs.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {compileAttoScalarV1, compileProgramV2} from "../src/program-v2.mjs";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const guests = [
  ["37-case", read("./stdlib/websocket_quic_compute_smoke.atto")],
  ["109-case", read("./stdlib/protocol_boundaries.atto")],
];
const libs = ["websocket", "quic", "compute"].map(name => [
  name, read("../stdlib/std/" + name + ".atto"),
]);

test("real JS compiler emits and executes a supported Atto scalar control guest", async () => {
  const js = compileAttoScalarV1("pub fnc main(): int { return 40 + 2; }");
  const guest = await import("data:text/javascript;charset=utf-8," + encodeURIComponent(js));
  assert.equal(guest.main(), 42n);
});

test("37- and 109-case imported Atto std guests reject unsupported JS lowering", () => {
  for (const [name, source] of guests) {
    assert.match(source, /import fnc /, name + " must exercise real source imports");
    assert.match(source, /\breturn 0;\s*\}\s*$/, name + " missing guest completion marker");
    assert.throws(() => compileAttoScalarV1(source), name + " must not silently compile");
    assert.throws(() => compileProgramV2(source), name + " must not bypass importer");
  }
});

test("the three real .atto stdlib modules cannot be misrepresented as JS ESM guests", () => {
  for (const [name, source] of libs) {
    assert.ok(source.includes("pub fnc " + name + "_"), name + " real Atto API missing");
    assert.throws(() => compileAttoScalarV1(source),
      name + " cannot claim host-only fallback as Atto guest code");
  }
});
