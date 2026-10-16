// Run with: node --test tests/
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { parseApprovalLogs, fetchLogsRange, PERMIT2 } from '../src/discovery/approvals.js';
import { revokeCalls } from '../src/utils/rescueTx.js';
import { reviewCall } from '../src/utils/callReview.js';

const addr = () => ethers.Wallet.createRandom().address;
const pad = (a) => ethers.zeroPadValue(a, 32);
const OWNER = addr();
const SAFE = addr();
const APPROVAL = ethers.id('Approval(address,address,uint256)');
const FOR_ALL = ethers.id('ApprovalForAll(address,address,bool)');
const P2 = ethers.id('Approval(address,address,address,uint160,uint48)');

test('ERC-20 approvals (3 topics) are kept; ERC-721 single approvals (4 topics) are skipped', () => {
  const token = addr(); const spender = addr(); const nft = addr();
  const candidates = parseApprovalLogs([
    { address: token, topics: [APPROVAL, pad(OWNER), pad(spender)] },
    { address: token, topics: [APPROVAL, pad(OWNER), pad(spender)] }, // duplicate
    { address: nft, topics: [APPROVAL, pad(OWNER), pad(addr()), ethers.toBeHex(7, 32)] }
  ]);
  assert.deepEqual(candidates, [{ kind: 'erc20', token, spender }]);
});

test('operator and Permit2 approvals are parsed; Permit2 events from other contracts are ignored', () => {
  const collection = addr(); const operator = addr(); const token = addr(); const spender = addr();
  const candidates = parseApprovalLogs([
    { address: collection, topics: [FOR_ALL, pad(OWNER), pad(operator)] },
    { address: PERMIT2, topics: [P2, pad(OWNER), pad(token), pad(spender)] },
    { address: addr(), topics: [P2, pad(OWNER), pad(token), pad(spender)] }
  ]);
  assert.deepEqual(candidates, [
    { kind: 'operator', token: collection, spender: operator },
    { kind: 'permit2', token, spender }
  ]);
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// The API returns at most 1000 logs and ignores `page`. A capped range must be split, or
// approvals past the cap would silently stay with the attacker.
test('a range that hits the 1000 cap is split until every part is complete', async () => {
  const queried = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const from = Number(u.searchParams.get('fromBlock'));
    const to = Number(u.searchParams.get('toBlock'));
    queried.push([from, to]);
    // 1500 logs spread over blocks 0..999: any range wider than 600 blocks hits the cap.
    const count = Math.min(1000, Math.round(((to - from + 1) / 1000) * 1500));
    return new Response(JSON.stringify({ status: '1', result: Array.from({ length: count }, (_, i) => ({ i, from })) }));
  };
  const budget = { count: 0, truncated: false };
  const logs = await fetchLogsRange('https://eth.blockscout.com', {}, 0, 999, budget);
  assert.equal(budget.truncated, false);
  assert.equal(logs.length, 1500);
  assert.deepEqual(queried, [[0, 999], [0, 499], [500, 999]]);
});

test('splitting stops at the query budget and reports a partial scan', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ status: '1', result: Array.from({ length: 1000 }, () => ({})) }));
  const budget = { count: 0, truncated: false };
  await fetchLogsRange('https://eth.blockscout.com', {}, 0, 1_000_000, budget);
  assert.equal(budget.count, 32);
  assert.equal(budget.truncated, true);
});

test('"No logs found" is an empty result; other API errors surface', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ status: '0', message: 'No logs found', result: [] }));
  assert.deepEqual(await fetchLogsRange('https://x.example', {}, 0, 10, { count: 0, truncated: false }), []);
  globalThis.fetch = async () => new Response(JSON.stringify({ status: '0', message: 'Query timeout', result: null }));
  await assert.rejects(fetchLogsRange('https://x.example', {}, 0, 10, { count: 0, truncated: false }), /Query timeout/);
});

test('revoke calls decode to zero, false and a Permit2 lockdown, and the review shows them as ok', () => {
  const token = addr(); const spender = addr(); const collection = addr(); const operator = addr(); const p2token = addr(); const p2spender = addr();
  const calls = revokeCalls([
    { kind: 'erc20', token, spender },
    { kind: 'operator', token: collection, spender: operator },
    { kind: 'permit2', token: p2token, spender: p2spender },
    { kind: 'permit2', token, spender }
  ], PERMIT2);
  assert.equal(calls.length, 3);
  const iface = new ethers.Interface(['function approve(address,uint256)', 'function setApprovalForAll(address,bool)', 'function lockdown((address,address)[])']);
  assert.deepEqual([...iface.decodeFunctionData('approve', calls[0].data)], [spender, 0n]);
  assert.deepEqual([...iface.decodeFunctionData('setApprovalForAll', calls[1].data)], [operator, false]);
  const [pairs] = iface.decodeFunctionData('lockdown', calls[2].data);
  assert.deepEqual(pairs.map((p) => [...p]), [[p2token, p2spender], [token, spender]]);
  for (const call of calls) assert.equal(reviewCall(call, SAFE).level, 'ok', call.functionName);
});

// approve(x, 0) on an NFT contract approves token #0. Only the revoker, which confirmed an
// ERC-20 allowance on-chain, may have that call shown as safe.
test('a pasted approve(x, 0) is not trusted as a revoke', () => {
  const data = new ethers.Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [addr(), 0n]);
  assert.notEqual(reviewCall({ target: addr(), value: 0n, data, source: 'custom' }, SAFE).level, 'ok');
  const lockdown = new ethers.Interface(['function lockdown((address,address)[])']).encodeFunctionData('lockdown', [[[addr(), addr()]]]);
  assert.equal(reviewCall({ target: addr(), value: 0n, data: lockdown, source: 'custom' }, SAFE).level, 'unknown');
});
