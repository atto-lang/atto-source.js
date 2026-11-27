import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadonlyCopyDomain } from '../src/readonly-copy-domain.mjs';

test('deterministic root reachability and transitive read-loan differential', () => {
  let state = 0x23b41f07;
  const pick = n => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % n;
  };
  let checks = 0;
  for (let trial = 0; trial < 128; trial++) {
    const d = new ReadonlyCopyDomain({ maxRoots: 10, maxLoans: 8 });
    const roots = [], loans = [], graphs = [];
    const make = () => {
      const owner = d.create({ dynamic: true });
      d.initialize(owner, 'n', 0);
      d.finish(owner);
      return owner;
    };
    const initial = make();
    roots.push({ owner: initial, id: d.identity(initial), edges: [null, null] });
    const keys = ['a', 'b'];
    const install = (r, slot) => {
      const childOwner = make(), leafOwner = make();
      const g = { child: d.identity(childOwner), leaf: d.identity(leafOwner) };
      d.moveInto(childOwner, g.child, 'leaf', leafOwner);
      d.moveInto(r.owner, r.id, keys[slot], childOwner);
      r.edges[slot] = g;
      graphs.push(g);
    };
    install(roots[0], 0);
    for (let step = 0; step < 96; step++) {
      const r = roots[pick(roots.length)], slot = pick(2), g = r.edges[slot];
      switch (pick(8)) {
        case 0:
          if (roots.length < 8) {
            const owner = d.copy(r.owner);
            roots.push({ owner, id: d.identity(owner), edges: [...r.edges] });
          }
          break;
        case 1:
          install(r, slot);
          break;
        case 2:
          if (g !== null) {
            d.remove(r.owner, r.id, keys[slot]);
            r.edges[slot] = null;
          }
          break;
        case 3:
          if (g !== null) {
            d.linkWithin(r.owner, r.id, keys[1 - slot], g.child);
            r.edges[1 - slot] = g;
          }
          break;
        case 4:
          if (g !== null && loans.length < 8) {
            const leafOnly = pick(2) === 0;
            loans.push({ token: d.readLoan(r.owner, leafOnly ? g.leaf : g.child), g, leafOnly });
          }
          break;
        case 5:
          if (loans.length > 0) {
            const [l] = loans.splice(pick(loans.length), 1);
            d.release(l.token);
            assert.throws(() => d.release(l.token), { code: 'E_COPY_STALE' });
          }
          break;
        case 6:
          if (roots.length > 1) {
            d.drop(r.owner);
            roots.splice(roots.indexOf(r), 1);
            assert.throws(() => d.identity(r.owner), { code: 'E_COPY_STALE' });
          }
          break;
        case 7:
          d.setScalar(r.owner, r.id, 'n', step);
          assert.equal(d.read(r.owner, r.id, 'n'), step);
          break;
      }
      for (const candidate of graphs) {
        const holders = roots.filter(x => x.edges.includes(candidate)).length;
        const childReaders = loans.some(l => l.g === candidate && !l.leafOnly);
        const leafReaders = loans.some(l => l.g === candidate);
        for (const root of roots) {
          const owns = root.edges.includes(candidate);
          for (const [id, readers] of [[candidate.child, childReaders], [candidate.leaf, leafReaders]]) {
            const expected = owns && holders === 1 && !readers;
            assert.equal(d.canWrite(root.owner, id), expected, `trial=${trial} step=${step}`);
            checks++;
            if (!owns) continue;
            if (expected) {
              d.setScalar(root.owner, id, 'n', step);
              assert.equal(d.read(root.owner, id, 'n'), step);
            } else {
              assert.throws(() => d.setScalar(root.owner, id, 'n', step), {
                code: holders > 1 ? 'E_COPY_READONLY' : 'E_COPY_LOAN',
              });
            }
            checks++;
          }
        }
      }
    }
    for (const l of loans) d.release(l.token);
    for (const r of roots) d.drop(r.owner);
  }
  assert.ok(checks > 100000);
  console.log(`COPY_DOMAIN_DIFFERENTIAL checks=${checks} trials=128 steps=96`);
});
