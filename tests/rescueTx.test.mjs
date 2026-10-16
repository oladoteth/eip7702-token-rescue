// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateRescueGas, MAX_TX_GAS } from '../src/utils/rescueTx.js';

const stub = (estimate, blockGasLimit) => ({
  estimateGas: async () => estimate,
  getBlock: async () => ({ gasLimit: blockGasLimit })
});

// Since Fusaka (EIP-7825) one transaction may use at most 2^24 gas on Ethereum, even though
// blocks are larger. A batch over that is rejected by nodes, so it must be caught before sending.
test('a batch over the per-transaction cap is refused even when the block limit is higher', async () => {
  await assert.rejects(estimateRescueGas(stub(14_000_000n, 60_000_000n), {}, '0x0'), /more than one transaction can use \(16777216\)/);
});

test('the lower of block limit and per-transaction cap is the ceiling', async () => {
  assert.equal((await estimateRescueGas(stub(100_000n, 60_000_000n), {}, '0x0')).maxGas, MAX_TX_GAS);
  assert.equal((await estimateRescueGas(stub(100_000n, 10_000_000n), {}, '0x0')).maxGas, 10_000_000n);
});

test('gas limit is the estimate plus a 25% buffer', async () => {
  const { estimate, gasLimit } = await estimateRescueGas(stub(200_000n, 30_000_000n), {}, '0x0');
  assert.equal(estimate, 200_000n);
  assert.equal(gasLimit, 250_000n);
});
