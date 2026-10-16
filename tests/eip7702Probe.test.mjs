// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeEip7702 } from '../src/utils/eip7702Probe.js';

const reverted = () => Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' });
const stub = ({ multicall = true, estimateGas, network = { chainId: 1n } }) => ({
  getNetwork: async () => network,
  getCode: async () => (multicall ? '0x6080' : '0x'),
  estimateGas
});

// The probe gates the whole rescue, so each answer must come from observed behaviour.
const revertsOnlyWhenDelegated = async (tx) => {
  if (tx.authorizationList) throw reverted();
  return 21000n;
};

test('delegated code running (revert) means supported', async () => {
  assert.equal((await probeEip7702(stub({ estimateGas: revertsOnlyWhenDelegated }))).supported, true);
});

// Fail closed: an RPC that errors on every estimate must not look like 7702 support.
test('a revert is only proof when the same call without delegation succeeds', async () => {
  const alwaysReverts = stub({ estimateGas: async () => { throw reverted(); } });
  const result = await probeEip7702(alwaysReverts);
  assert.equal(result.supported, false);
  assert.match(result.reason, /control/);
});

// An RPC that drops authorizationList simulates a plain transfer, which succeeds.
// Found live: sepolia.drpc.org. The rescue's safety simulation would prove nothing there.
test('a call that succeeds means the authorization was ignored', async () => {
  assert.equal((await probeEip7702(stub({ estimateGas: async () => 21000n }))).supported, false);
});

test('a non-revert error means type-4 is rejected', async () => {
  const result = await probeEip7702(stub({ estimateGas: async () => { throw new Error('transaction type not supported'); } }));
  assert.equal(result.supported, false);
  assert.match(result.reason, /rejected/);
});

// Without Multicall3, compare against the same call without the authorization, because
// chains like zkSync charge far more than 21,000 for a plain transfer.
test('without Multicall3 the authorization must add at least 12,500 gas over the control', async () => {
  const charged = stub({ multicall: false, estimateGas: async (tx) => (tx.authorizationList ? 171_000n : 146_000n) });
  assert.equal((await probeEip7702(charged)).supported, true);
  const ignored = stub({ multicall: false, estimateGas: async (tx) => (tx.authorizationList ? 147_000n : 146_000n) });
  assert.equal((await probeEip7702(ignored)).supported, false);
});

test('the authorization is signed for a sender other than the authority', async () => {
  let seen;
  await probeEip7702(stub({ estimateGas: async (tx) => { if (tx.authorizationList) seen = tx; return revertsOnlyWhenDelegated(tx); } }));
  assert.notEqual(seen.from.toLowerCase(), seen.to.toLowerCase());
  assert.equal(seen.authorizationList[0].nonce, 0n);
});

test('an unreachable RPC is unknown, not unsupported', async () => {
  const down = { getNetwork: async () => { throw new Error('fetch failed'); } };
  assert.equal((await probeEip7702(down)).supported, null);
});
