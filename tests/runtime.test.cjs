const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { applyExpression, restoreExpression, heartbeatExpression, LEASE_MS } = require('../core/runtime.cjs');
function fixture() {
  const nodes = new Map(), intervals = new Set();
  let now = 1000;
  const document = {
    getElementById: id => nodes.get(id) || null,
    createElement: () => ({ dataset: {}, sheet: { cssRules: [{}] }, isConnected: false, remove() { nodes.delete(this.id); this.isConnected = false; } }),
    head: { appendChild(s) { nodes.set(s.id, s); s.isConnected = true; } },
  };
  const context = vm.createContext({ document, Date: { now: () => now }, setInterval: fn => { intervals.add(fn); return fn; }, clearInterval: fn => intervals.delete(fn) });
  return { evaluate: text => vm.runInContext(text, context), nodes, intervals, advance: ms => { now += ms; for (const fn of intervals) fn(); } };
}
test('apply replaces only its own style, restore preserves unrelated styles', () => {
  const f = fixture();
  f.nodes.set('host-style', { textContent: 'host' });
  f.evaluate(applyExpression('body{color:red}', 'owner'));
  f.evaluate(applyExpression('body{color:blue}', 'owner'));
  assert.equal(f.nodes.size, 2);
  assert.throws(() => f.evaluate(applyExpression('body{display:none}', 'other')));
  assert.equal(f.evaluate(restoreExpression('other')), false);
  assert.equal(f.evaluate(restoreExpression('owner')), true);
  assert.equal(f.nodes.get('host-style').textContent, 'host');
  assert.equal(f.nodes.size, 1);
});
test('lost heartbeat removes temporary style, active lease extends lifespan', () => {
  const f = fixture();
  f.evaluate(applyExpression('body{color:red}', 'owner'));
  f.advance(LEASE_MS - 1000);
  assert.equal(f.evaluate(heartbeatExpression('owner')), true);
  f.advance(2000);
  assert.equal(f.nodes.size, 1);
  f.advance(LEASE_MS);
  assert.equal(f.nodes.size, 0);
  assert.equal(f.intervals.size, 0);
});
