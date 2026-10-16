// Run with: node --test tests/
// Real-protocol coverage lives in scripts/fork-positions.mjs (needs network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { buildPositionCalls, adaptersFor } from '../src/positions/index.js';
import { reviewCall } from '../src/utils/callReview.js';
import { coveredKeys, erc20Key, nftKey } from '../src/utils/batchKeys.js';

const FROM = ethers.Wallet.createRandom().address;
const SAFE = ethers.Wallet.createRandom().address;
const addr = () => ethers.Wallet.createRandom().address;

// Every adapter call must pass the pre-send review as going to the safe wallet.
const expectSafe = (calls) => calls.forEach((c) => assert.equal(reviewCall(c, SAFE).level, 'ok', c.functionName));

test('Lido: exact shares, claim to the safe wallet with the scanned hints, pending NFTs moved', () => {
  const steth = addr();
  const queue = addr();
  const [transfer] = buildPositionCalls({ adapter: 'lido', covers: [erc20Key(steth)], data: { steth, shares: 123n } }, 'transfer-shares', { from: FROM, to: SAFE });
  assert.deepEqual([...new ethers.Interface(['function transferShares(address,uint256)']).decodeFunctionData('transferShares', transfer.data)], [SAFE, 123n]);

  const [claim] = buildPositionCalls({ adapter: 'lido', covers: [], data: { withdrawalQueue: queue, ids: [5n, 9n], hints: [100n, 101n] } }, 'claim', { from: FROM, to: SAFE });
  const [ids, hints, recipient] = new ethers.Interface(['function claimWithdrawalsTo(uint256[],uint256[],address)']).decodeFunctionData('claimWithdrawalsTo', claim.data);
  assert.deepEqual([[...ids], [...hints], recipient], [[5n, 9n], [100n, 101n], SAFE]);

  const moves = buildPositionCalls({ adapter: 'lido', covers: [], data: { withdrawalQueue: queue, ids: [7n, 8n] } }, 'transfer-nfts', { from: FROM, to: SAFE });
  assert.equal(moves.length, 2);
  expectSafe([transfer, claim, ...moves]);
});

// MaxUint256 makes Aave withdraw the balance at execution time, interest included.
test('Aave: withdraw sends the full balance to the safe wallet; aToken move is the fallback', () => {
  const data = { pool: addr(), asset: addr(), aToken: addr(), supply: 1000n, symbol: 'WETH' };
  const [withdraw] = buildPositionCalls({ adapter: 'aave-v3', covers: [], data }, 'withdraw', { from: FROM, to: SAFE });
  const [asset, amount, to] = new ethers.Interface(['function withdraw(address,uint256,address)']).decodeFunctionData('withdraw', withdraw.data);
  assert.deepEqual([asset, amount, to], [data.asset, ethers.MaxUint256, SAFE]);
  assert.equal(withdraw.target, data.pool);
  const [move] = buildPositionCalls({ adapter: 'aave-v3', covers: [], data }, 'transfer-atoken', { from: FROM, to: SAFE });
  assert.equal(move.target, data.aToken);
  expectSafe([withdraw, move]);
});

test('Uniswap v3: the position NFT moves from the compromised wallet to the safe wallet', () => {
  const manager = addr();
  const [move] = buildPositionCalls({ adapter: 'uniswap-v3', covers: [nftKey(manager, 42n)], data: { manager, tokenId: 42n } }, 'transfer-nft', { from: FROM, to: SAFE });
  assert.deepEqual([...new ethers.Interface(['function safeTransferFrom(address,address,uint256)']).decodeFunctionData('safeTransferFrom', move.data)], [FROM, SAFE, 42n]);
  expectSafe([move]);
});

// Moving the same asset twice reverts the second call and with it the whole batch.
test('adapter calls cover the assets they move, so the scanner will not add them again', () => {
  const steth = addr();
  const [call] = buildPositionCalls({ adapter: 'lido', covers: [erc20Key(steth)], data: { steth, shares: 1n } }, 'transfer-shares', { from: FROM, to: SAFE });
  const keys = coveredKeys([call, { source: 'erc20', target: steth.toUpperCase().replace('0X', '0x') }]);
  assert.ok(keys.has(erc20Key(steth)));
  assert.equal(keys.size, 1);
});

test('adapters are offered only where their contracts are deployed', () => {
  const ids = (chainId) => adaptersFor({ chainId }).map((a) => a.id).sort();
  assert.deepEqual(ids(1), ['aave-v3', 'lido', 'uniswap-v3']);
  assert.deepEqual(ids(57073), ['uniswap-v3']); // Ink: no Aave, no Lido
  assert.deepEqual(ids(31337), []);
  assert.deepEqual(adaptersFor({ chainId: 31337, positionsChainId: 1 }).map((a) => a.id).sort(), ['aave-v3', 'lido', 'uniswap-v3']);
});
