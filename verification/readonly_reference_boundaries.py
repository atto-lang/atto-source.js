#!/usr/bin/env python3
"""Same bounded source and linked guest checks on three backends."""
import pathlib, subprocess, sys, tempfile
S = """// atto-ownership: borrow-default-v1
define class Parcel as pub let int padding = 99; pub let int value = 21; end
fnc get(Parcel p): int { return p.value; }
fnc forward(Parcel p): int { return get(p); }
pub fnc main(): int { let p = new Parcel(); return forward(p) + get(p); }
"""
def shape(n=8):
    fields = " ".join(f"pub let int f{i} = 6;" for i in range(n))
    helpers = "fnc h0(Parcel p): int { return p.f0; } " + " ".join(f"fnc h{i}(Parcel p): int {{ return h{i-1}(p); }}" for i in range(1,8))
    return "// atto-ownership: borrow-default-v1\n" + f"define class Parcel as {fields} end\n{helpers}\npub fnc main(): int {{ let p = new Parcel(); return " + " + ".join(f"h{i}(p)" for i in [0,1,2,3,4,5,7]) + "; }\n"
def main():
    backend, compiler = sys.argv[1:]
    compiler = str(pathlib.Path(compiler).resolve())
    cases = [
        ("ordinary", S, 42),
        ("maximum-fields-helpers", shape(), 42),
        ("maximum-calls", shape().replace("return h0(p) +", "return h0(p) - h0(p) +").replace("f0 = 6", "f0 = 7"), 42),
        ("last-field", S.replace("p.value", "p.padding").replace("padding = 99", "padding = 21"), 42),
        ("ordered-subtraction", S.replace("padding = 99", "padding = 63").replace("return forward(p) + get(p);", "return forward(p) - get(p);").replace("return get(p);", "return p.padding;"), 42),
        ("nineteen-digits", S.replace("value = 21", "value = 0000000000000000021"), 42),
        ("twenty-digits", S.replace("value = 21", "value = 00000000000000000021"), None),
        ("nine-fields", shape(9), None),
        ("nine-helpers", shape().replace("pub fnc main", "fnc h8(Parcel p): int { return h7(p); } pub fnc main"), None),
        ("nine-calls", shape().replace("return h0(p) +", "return h0(p) + h0(p) + h0(p) +"), None),
        ("del-comment", S + "//\x7f\n", None),
        ("unicode-comment", S + "// é\n", None),
        ("overflow-literal", S.replace("value = 21", "value = 9223372036854775808"), None),
        ("mutation", S.replace("return p.value;", "p.value = 1; return p.value;"), None),
        ("missing-field", S.replace("p.value", "p.unknown"), None),
        ("recursive", S.replace("return get(p);", "return forward(p);"), None),
    ]
    with tempfile.TemporaryDirectory() as tmp:
        d = pathlib.Path(tmp)
        for name, source, expected in cases:
            path = d / (name + ".atto")
            path.write_text(source, encoding="utf-8")
            if backend == "js":
                out = d / (name + ".mjs")
                cmd = ["node", compiler, "--readonly-reference-v1", str(path), "--out=" + str(out)]
            elif backend == "forge":
                out = d / (name + ".s")
                cmd = [compiler, "emit-readonly-asm", "x86_64", str(path)]
            elif backend == "cranelift":
                out = d / (name + ".o")
                cmd = [compiler, "emit-object", str(path)]
            else:
                raise AssertionError(backend)
            p = subprocess.run(cmd, capture_output=True)
            if expected is None:
                assert p.returncode > 0 and not p.stdout and (not out.exists() or out.stat().st_size == 0), (name, p.returncode, p.stdout, p.stderr)
            else:
                assert p.returncode == 0, (name, p.stderr)
                if backend == "js":
                    subprocess.run(["node", "--input-type=module", "-e", "const m=await import(process.argv[1]);if(m.main()!==42n)process.exit(1)", str(out)], check=True)
                else:
                    out.write_bytes(p.stdout)
                    host = d / "host.c"
                    if backend == "forge":
                        host.write_text("#include <stdint.h>\nextern int64_t oresforge_entry(void);int main(void){return oresforge_entry()!=42;}\n")
                    else:
                        host.write_text("#include <stdint.h>\nextern int32_t oreslang_scalar_entry(int64_t,int64_t,int64_t,int64_t,int64_t*);int main(void){int64_t o=0;return oreslang_scalar_entry(0,0,0,0,&o)!=0||o!=42;}\n")
                    exe = d / "guest"
                    subprocess.run(["clang", str(out), str(host), "-o", str(exe)], check=True)
                    subprocess.run([str(exe)], check=True)
            print(f"{backend}|{name}|{'GUEST_PASS' if expected is not None else 'EXPECTED_REJECT'}", flush=True)
if __name__ == "__main__":
    main()
