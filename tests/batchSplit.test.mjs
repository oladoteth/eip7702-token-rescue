// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEstimateError, largestFittingPrefix, planParts } from '../src/utils/batchSplit.js';

// Stub: each call costs `cost` gas, the transaction fits under `max`. A call with
// `revertsAlone` reverts; a call with `needs` reverts unless that call is in the same estimate.
const BASE = 50_000;
const stub = (max) => async (calls) => {
  for (const c of calls) {
    if (c.revertsAlone) throw new Error(`Call #${calls.indexOf(c) + 1} in the batch reverted: nope`);
    if (c.needs !== undefined && !calls.some((o) => o.id === c.needs)) throw new Error(`Call #${calls.indexOf(c) + 1} in the batch reverted: balance`);
  }
  const gas = BigInt(BASE + calls.reduce((sum, c) => sum + c.cost, 0));
  if (gas > BigInt(max)) throw new Error(`The batch needs ${gas} gas, more than one transaction can use (${max}).`);
  return { gasLimit: gas };
};
const calls = (n, cost = 10_000) => Array.from({ length: n }, (_, id) => ({ id, cost }));

test('errors are classified: size problems split, reverts stop', () => {
  assert.equal(classifyEstimateError(new Error('The batch needs 9 gas, more than one transaction can use (1).')), 'too-large');
  assert.equal(classifyEstimateError(new Error('gas required exceeds allowance (30000000)')), 'too-large');
  assert.equal(classifyEstimateError(new Error('Call #3 in the batch reverted: balance')), 'revert');
  assert.equal(classifyEstimateError(new Error('network timeout')), 'other');
  assert.equal(classifyEstimateError(new Error('Call #30 in the batch reverted: 0x')), 'empty-revert');
  assert.equal(classifyEstimateError(new Error('Call #2 in the batch reverted: no reason given')), 'empty-revert');
  assert.equal(classifyEstimateError(new Error('missing revert data (action="estimateGas", data=null)')), 'empty-revert');
});

// Found on anvil: past the gas cap, the node's simulation runs an inner call out of gas and
// the delegate reports CallFailed with empty data. That must shrink the part, not abort.
test('a reason-less revert in a multi-call prefix is treated as too large', async () => {
  const oog = async (cs) => {
    if (cs.length > 4) throw new Error(`Call #${cs.length} in the batch reverted: 0x`);
    return { gasLimit: BigInt(cs.length * 1000) };
  };
  const { parts } = await planParts(calls(10), oog);
  assert.deepEqual(parts.map((p) => p.calls.length), [4, 4, 2]);
  await assert.rejects(planParts([{ id: 0 }], async () => { throw new Error('Call #1 in the batch reverted: 0x'); }), /reverted: 0x/);
});

test('the largest prefix that fits is found', async () => {
  // 50k base + 10k per call under 155k: 10 calls fit.
  const { count, gasLimit } = await largestFittingPrefix(calls(37), stub(155_000));
  assert.equal(count, 10);
  assert.equal(gasLimit, 150_000n);
});

// Every call must be sent exactly once, in order: a dropped call is an asset left behind.
test('parts cover every call once, in order, each under the limit', async () => {
  const all = calls(37);
  const { parts, rest } = await planParts(all, stub(155_000));
  assert.deepEqual(rest, []);
  assert.deepEqual(parts.map((p) => p.calls.length), [10, 10, 10, 7]);
  assert.deepEqual(parts.flatMap((p) => p.calls), all);
  assert.ok(parts.every((p) => p.gasLimit <= 155_000n));
});

test('a batch that fits is one part', async () => {
  const { parts } = await planParts(calls(5), stub(1_000_000));
  assert.equal(parts.length, 1);
});

test('one call too large for any transaction is an error, not an endless split', async () => {
  await assert.rejects(planParts([{ id: 0, cost: 500_000, contractName: 'Big', functionName: 'doIt' }], stub(155_000)), /alone needs more gas/);
});

test('a call that reverts on its own stops planning with the reason', async () => {
  const all = calls(3);
  all[0].revertsAlone = true;
  await assert.rejects(planParts(all, stub(155_000)), /reverted: nope/);
});

// Unstake in part 1, move the released tokens in part 2: part 2 cannot be simulated until
// part 1 is mined, so planning stops and hands back the rest.
test('a part that depends on an earlier part is planned after that part is mined', async () => {
  const all = calls(15);
  all[12].needs = 0;
  const { parts, rest } = await planParts(all, stub(155_000));
  assert.deepEqual(parts.map((p) => p.calls.length), [10]);
  assert.deepEqual(rest, all.slice(10));
});
