// Run with: node --test tests/
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { classifyErc20, MIN_VALUABLE_USD } from '../src/discovery/classify.js';
import { listBlockscoutTokens } from '../src/discovery/blockscout.js';

const addr = () => ethers.Wallet.createRandom().address;
const candidate = (overrides = {}) => ({
  type: 'ERC-20', token: addr(), symbol: 'TKN', name: 'Token', decimals: 18, priceUsd: null, tokenId: null, ...overrides
});
const balancesOf = (entries) => new Map(entries.map(([c, b]) => [c.token.toLowerCase(), b]));

// The explorer is only a hint. A token it lists that the wallet does not hold on-chain
// (stale index, reorg, or an attacker who already moved it) must never become a call.
test('tokens with zero, missing or failed on-chain balance are dropped', () => {
  const zero = candidate();
  const missing = candidate();
  const reverted = candidate();
  const held = candidate({ priceUsd: 2 });
  const assets = classifyErc20([zero, missing, reverted, held], balancesOf([[zero, 0n], [reverted, null], [held, 10n ** 18n]]), new Map());
  assert.deepEqual(assets.map((a) => a.token), [held.token]);
  assert.equal(assets[0].balance, 10n ** 18n);
});

test('value uses the on-chain balance, not the explorer', () => {
  const usdc = candidate({ symbol: 'USDC', decimals: 6, priceUsd: 1 });
  const [asset] = classifyErc20([usdc], balancesOf([[usdc, 2_500_000n]]), new Map());
  assert.equal(asset.valueUsd, 2.5);
  assert.equal(asset.category, 'valuable');
});

test('DefiLlama price is used only when the explorer has none', () => {
  const a = candidate({ priceUsd: 3 });
  const b = candidate();
  const prices = new Map([[a.token.toLowerCase(), 100], [b.token.toLowerCase(), 5]]);
  const assets = classifyErc20([a, b], balancesOf([[a, 10n ** 18n], [b, 10n ** 18n]]), prices);
  assert.equal(assets.find((x) => x.token === a.token).priceUsd, 3);
  assert.equal(assets.find((x) => x.token === b.token).priceUsd, 5);
});

// Pre-selection follows the category, so these boundaries decide what moves by default.
test('categories: valuable at the threshold, dust below, unpriced without price', () => {
  const atThreshold = candidate({ priceUsd: MIN_VALUABLE_USD });
  const below = candidate({ priceUsd: MIN_VALUABLE_USD / 2 });
  const noPrice = candidate();
  const noDecimals = candidate({ decimals: null, priceUsd: 1 });
  const all = [atThreshold, below, noPrice, noDecimals];
  const assets = classifyErc20(all, balancesOf(all.map((c) => [c, 10n ** 18n])), new Map());
  const category = (c) => assets.find((a) => a.token === c.token).category;
  assert.equal(category(atThreshold), 'valuable');
  assert.equal(category(below), 'dust');
  assert.equal(category(noPrice), 'unpriced');
  assert.equal(category(noDecimals), 'unpriced');
});

// Scam tokens fake a price or a big balance to get clicked. The name check wins.
test('scam names are spam even when priced', () => {
  const names = ['Visit claim-usdt.com', 'ETH Airdrop', '$1000 Reward t.me/x', 'www.free.io'];
  const all = names.map((name) => candidate({ name, priceUsd: 1000 }));
  const assets = classifyErc20(all, balancesOf(all.map((c) => [c, 10n ** 18n])), new Map());
  assert.ok(assets.every((a) => a.category === 'spam'), JSON.stringify(assets.map((a) => [a.name, a.category])));
  const legit = candidate({ name: 'Wrapped Ether', symbol: 'WETH', priceUsd: 3000 });
  assert.equal(classifyErc20([legit], balancesOf([[legit, 10n ** 18n]]), new Map())[0].category, 'valuable');
});

// Real tokens are named after their domains (YFI is "yearn.finance"). Found in a live scan.
test('a domain in the name alone is not spam', () => {
  const yfi = candidate({ name: 'yearn.finance', symbol: 'YFI', priceUsd: 5000 });
  const sfi = candidate({ name: 'saffron.finance', symbol: 'SFI', priceUsd: 50 });
  const assets = classifyErc20([yfi, sfi], balancesOf([[yfi, 10n ** 18n], [sfi, 10n ** 18n]]), new Map());
  assert.deepEqual(assets.map((a) => a.category), ['valuable', 'valuable']);
});

test('sorted valuable first by value, then dust, unpriced, spam; duplicates and NFTs ignored', () => {
  const big = candidate({ priceUsd: 100 });
  const small = candidate({ priceUsd: 2 });
  const dust = candidate({ priceUsd: 0.000001 });
  const spam = candidate({ name: 'claim now', priceUsd: 9999 });
  const nft = candidate({ type: 'ERC-721' });
  const all = [spam, dust, small, big, { ...big }, nft];
  const assets = classifyErc20(all, balancesOf(all.map((c) => [c, 10n ** 18n])), new Map());
  assert.deepEqual(assets.map((a) => a.token), [big.token, small.token, dust.token, spam.token]);
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('Blockscout pagination follows next_page_params and maps fields', async () => {
  const token = addr();
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const second = String(url).includes('items_count');
    return new Response(JSON.stringify({
      items: [{ token: { type: 'ERC-20', address_hash: token.toLowerCase(), symbol: 'A', name: 'A', decimals: '6', exchange_rate: second ? null : '1.5' }, token_id: null, value: '1' }],
      next_page_params: second ? null : { id: 7, items_count: 50, fiat_value: '12.5' }
    }));
  };
  const { candidates, truncated } = await listBlockscoutTokens('https://eth.blockscout.com', addr());
  assert.equal(urls.length, 2);
  assert.match(urls[1], /items_count=50/);
  assert.equal(truncated, false);
  assert.equal(candidates[0].token, token); // checksummed
  assert.equal(candidates[0].decimals, 6);
  assert.equal(candidates[0].priceUsd, 1.5);
  assert.equal(candidates[1].priceUsd, null);
});

// Heavy spam wallets take over a minute per page. Pages past the last priced token are skipped.
test('Blockscout listing stops once the remaining tokens have no market price', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({
      items: [{ token: { type: 'ERC-20', address_hash: addr(), symbol: 'X', name: 'X', decimals: '18', exchange_rate: null }, token_id: null, value: '1' }],
      next_page_params: { id: calls, items_count: 50 * calls, fiat_value: null }
    }));
  };
  const result = await listBlockscoutTokens('https://eth.blockscout.com', addr());
  assert.equal(calls, 1);
  assert.equal(result.skippedUnpriced, true);
  assert.equal(result.truncated, false);
});

test('Blockscout HTTP errors surface instead of returning an empty wallet', async () => {
  globalThis.fetch = async () => new Response('busy', { status: 503 });
  await assert.rejects(listBlockscoutTokens('https://eth.blockscout.com', addr()), /HTTP 503/);
});

// ---- NFTs ----
import { classifyNfts } from '../src/discovery/classify.js';
import { listBlockscoutNfts } from '../src/discovery/blockscout.js';
import { nftKey } from '../src/discovery/balances.js';
import { nftTransferCalls } from '../src/utils/rescueTx.js';
import { reviewCall } from '../src/utils/callReview.js';

const nft = (overrides = {}) => ({ type: 'ERC-721', token: addr(), name: 'Collection', symbol: 'C', tokenId: 1n, ...overrides });

// Same rule as tokens: an NFT the chain does not confirm must never become a call.
test('NFTs not confirmed on-chain are dropped; ERC-1155 amount comes from the chain', () => {
  const owned = nft({ tokenId: 7n });
  const soldAlready = nft({ tokenId: 8n });
  const failedCall = nft({ tokenId: 9n });
  const multi = nft({ type: 'ERC-1155', tokenId: 3n });
  const holdings = new Map([
    [nftKey(owned.token, 7n), 1n],
    [nftKey(soldAlready.token, 8n), 0n],
    [nftKey(failedCall.token, 9n), null],
    [nftKey(multi.token, 3n), 25n]
  ]);
  const assets = classifyNfts([owned, soldAlready, failedCall, multi], holdings);
  assert.deepEqual(assets.map((a) => [a.tokenId, a.amount]).sort(), [[3n, 25n], [7n, 1n]]);
});

test('scam-named NFT collections are spam and sorted last', () => {
  const real = nft({ name: 'Azuki' });
  const scam = nft({ name: 'Claim your reward at bayc-mint.xyz' });
  const holdings = new Map([[nftKey(real.token, 1n), 1n], [nftKey(scam.token, 1n), 1n]]);
  assert.deepEqual(classifyNfts([scam, real], holdings).map((a) => a.category), ['nft', 'spam']);
});

// Every NFT call must pass the pre-send review as a transfer to the safe wallet,
// and ERC-1155 items from one collection go out in a single batch call.
test('NFT transfer calls: one per ERC-721, one batch per ERC-1155 collection, all to the safe wallet', () => {
  const from = addr();
  const safe = addr();
  const collection1155 = addr();
  const calls = nftTransferCalls([
    nft({ tokenId: 1n }),
    nft({ tokenId: 2n }),
    { type: 'ERC-1155', token: collection1155, name: 'Items', tokenId: 5n, amount: 3n },
    { type: 'ERC-1155', token: collection1155, name: 'Items', tokenId: 6n, amount: 1n }
  ], from, safe);

  assert.equal(calls.length, 3);
  const batch = calls.find((c) => c.source === 'erc1155');
  const decoded = new ethers.Interface(['function safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'])
    .decodeFunctionData('safeBatchTransferFrom', batch.data);
  assert.equal(decoded[0], from);
  assert.equal(decoded[1], safe);
  assert.deepEqual([...decoded[2]], [5n, 6n]);
  assert.deepEqual([...decoded[3]], [3n, 1n]);
  assert.deepEqual(batch.nftKeys, [nftKey(collection1155, 5n), nftKey(collection1155, 6n)]);
  for (const call of calls) {
    assert.equal(reviewCall(call, safe).level, 'ok', call.functionName);
  }
});

test('Blockscout NFT listing maps instances and follows pages', async () => {
  const token = addr();
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.match(String(url), /\/nft\?type=ERC-721%2CERC-1155/);
    return new Response(JSON.stringify({
      items: [{ id: String(calls * 10), token: { address_hash: token.toLowerCase(), name: 'N', symbol: 'N', type: 'ERC-721' }, token_type: 'ERC-721', value: '1' }],
      next_page_params: calls === 1 ? { token_type: 'ERC-721', token_id: '10', items_count: 50 } : null
    }));
  };
  const { candidates, truncated } = await listBlockscoutNfts('https://eth.blockscout.com', addr());
  assert.equal(calls, 2);
  assert.equal(truncated, false);
  assert.deepEqual(candidates.map((c) => c.tokenId), [10n, 20n]);
  assert.equal(candidates[0].token, token);
});
