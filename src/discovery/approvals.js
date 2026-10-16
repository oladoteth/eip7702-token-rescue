/**
 * Finds the approvals a compromised account has granted, so a rescue can revoke them.
 * Blockscout's logs API (free, no key) lists approval events; every one is then confirmed
 * on-chain, because spam contracts emit fake Approval events that name their victims.
 */

import { ethers } from 'ethers';
import { readMany } from './balances.js';

// Same address on every chain where Permit2 is deployed.
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

const APPROVAL_TOPIC = ethers.id('Approval(address,address,uint256)');
const APPROVAL_FOR_ALL_TOPIC = ethers.id('ApprovalForAll(address,address,bool)');
const PERMIT2_APPROVAL_TOPIC = ethers.id('Approval(address,address,address,uint160,uint48)');

// The logs API returns at most this many logs per query and ignores `page`.
const LOGS_CAP = 1000;
// Spam-heavy wallets can need many range splits. Beyond this, report a partial scan.
const MAX_QUERIES = 32;
const REQUEST_TIMEOUT_MS = 120000;

const readInterface = new ethers.Interface([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function symbol() view returns (string)'
]);

function topicAddress(topic) {
  return ethers.getAddress(ethers.dataSlice(topic, 12));
}

async function queryLogs(baseUrl, filter, fromBlock, toBlock, signal) {
  const url = new URL('/api', baseUrl);
  url.searchParams.set('module', 'logs');
  url.searchParams.set('action', 'getLogs');
  url.searchParams.set('fromBlock', String(fromBlock));
  url.searchParams.set('toBlock', String(toBlock));
  for (const [key, value] of Object.entries(filter)) url.searchParams.set(key, value);

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error(`Blockscout returned HTTP ${response.status}`);
  const body = await response.json();
  if (Array.isArray(body.result)) return body.result;
  if (/no logs found/i.test(body.message ?? '')) return [];
  throw new Error(`Blockscout logs query failed: ${body.message ?? 'unknown error'}`);
}

/**
 * Fetches every log matching `filter` in [fromBlock, toBlock]. A query that returns the cap
 * may be missing logs, so its range is split in half until each part is under the cap.
 * @param {string} baseUrl - Blockscout instance root
 * @param {object} filter - topic0, topic1, address and operator parameters
 * @param {number} fromBlock
 * @param {number} toBlock
 * @param {{count: number, truncated: boolean}} budget - Shared query counter
 * @param {AbortSignal} [signal]
 * @returns {Promise<object[]>} Raw logs
 */
export async function fetchLogsRange(baseUrl, filter, fromBlock, toBlock, budget, signal) {
  if (budget.count >= MAX_QUERIES) {
    budget.truncated = true;
    return [];
  }
  budget.count++;
  const logs = await queryLogs(baseUrl, filter, fromBlock, toBlock, signal);
  if (logs.length < LOGS_CAP) return logs;
  if (fromBlock >= toBlock) {
    budget.truncated = true;
    return logs;
  }
  const mid = Math.floor((fromBlock + toBlock) / 2);
  const left = await fetchLogsRange(baseUrl, filter, fromBlock, mid, budget, signal);
  const right = await fetchLogsRange(baseUrl, filter, mid + 1, toBlock, budget, signal);
  return [...left, ...right];
}

/**
 * Turns raw logs into unique (kind, token, spender) candidates. Pure: no network access.
 * ERC-721 single-token Approval logs (4 topics) are skipped: transferring the NFT clears them.
 * @param {object[]} logs
 * @returns {Array<{kind: 'erc20'|'operator'|'permit2', token: string, spender: string}>}
 */
export function parseApprovalLogs(logs) {
  const seen = new Set();
  const candidates = [];
  const add = (kind, token, spender) => {
    const key = `${kind}:${token.toLowerCase()}:${spender.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ kind, token, spender });
  };

  for (const log of logs) {
    const topics = log.topics?.filter(Boolean) ?? [];
    const topic0 = topics[0]?.toLowerCase();
    try {
      if (topic0 === PERMIT2_APPROVAL_TOPIC && log.address?.toLowerCase() === PERMIT2.toLowerCase() && topics.length === 4) {
        add('permit2', topicAddress(topics[2]), topicAddress(topics[3]));
      } else if (topic0 === APPROVAL_TOPIC && topics.length === 3) {
        add('erc20', ethers.getAddress(log.address), topicAddress(topics[2]));
      } else if (topic0 === APPROVAL_FOR_ALL_TOPIC && topics.length === 3) {
        add('operator', ethers.getAddress(log.address), topicAddress(topics[2]));
      }
    } catch {
      // Malformed log from a spam contract; ignore it.
    }
  }
  return candidates;
}

function decodeOr(name, result, fallback) {
  if (!result.success || result.returnData === '0x') return fallback;
  try {
    return readInterface.decodeFunctionResult(name, result.returnData);
  } catch {
    return fallback;
  }
}

/**
 * Keeps only approvals that are active on-chain right now.
 * ERC-20: allowance(owner, spender) > 0. An NFT contract has no allowance(), so the call
 * fails and the candidate is dropped; approve(spender, 0) is never built for an NFT contract,
 * where it would approve token #0. Operator: isApprovedForAll is true. Permit2: amount > 0
 * and not expired.
 * @param {ethers.Provider} provider
 * @param {string} owner
 * @param {Array} candidates - From parseApprovalLogs
 * @returns {Promise<Array<{kind: string, token: string, spender: string, amount: bigint|null, symbol: string|null}>>}
 */
export async function confirmApprovals(provider, owner, candidates) {
  if (candidates.length === 0) return [];
  const calls = candidates.map((c) => {
    if (c.kind === 'erc20') return { target: c.token, data: readInterface.encodeFunctionData('allowance(address,address)', [owner, c.spender]) };
    if (c.kind === 'operator') return { target: c.token, data: readInterface.encodeFunctionData('isApprovedForAll', [owner, c.spender]) };
    return { target: PERMIT2, data: readInterface.encodeFunctionData('allowance(address,address,address)', [owner, c.token, c.spender]) };
  });
  const [results, block] = await Promise.all([readMany(provider, calls), provider.getBlock('latest')]);
  const now = BigInt(block?.timestamp ?? Math.floor(Date.now() / 1000));

  const active = [];
  candidates.forEach((c, i) => {
    if (c.kind === 'erc20') {
      const amount = decodeOr('allowance(address,address)', results[i], null)?.[0];
      if (typeof amount === 'bigint' && amount > 0n) active.push({ ...c, amount });
    } else if (c.kind === 'operator') {
      if (decodeOr('isApprovedForAll', results[i], null)?.[0] === true) active.push({ ...c, amount: null });
    } else {
      const allowance = decodeOr('allowance(address,address,address)', results[i], null);
      if (allowance && allowance.amount > 0n && allowance.expiration >= now) active.push({ ...c, amount: allowance.amount });
    }
  });
  if (active.length === 0) return [];

  const tokens = [...new Set(active.map((a) => a.token))];
  const symbolResults = await readMany(provider, tokens.map((target) => ({ target, data: readInterface.encodeFunctionData('symbol') })));
  const symbols = new Map(tokens.map((t, i) => [t, decodeOr('symbol', symbolResults[i], null)?.[0] ?? null]));
  return active.map((a) => ({ ...a, symbol: symbols.get(a.token) }));
}

/**
 * Lists the account's active approvals on a chain with a Blockscout instance.
 * @param {object} params
 * @param {object} params.network - Entry from networks.js (needs discovery.blockscout)
 * @param {string} params.address - Compromised account
 * @param {ethers.Provider} params.provider
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{approvals: object[], truncated: boolean}>}
 */
export async function discoverApprovals({ network, address, provider, signal }) {
  const base = network?.discovery?.blockscout;
  if (!base) throw new Error(`Automatic approval scanning is not available on ${network?.name ?? 'this chain'}`);
  const owner = ethers.zeroPadValue(address, 32).toLowerCase();
  const latest = await provider.getBlockNumber();
  const budget = { count: 0, truncated: false };
  const query = (filter) => fetchLogsRange(base, { ...filter, topic1: owner, topic0_1_opr: 'and' }, 0, latest, budget, signal);

  const logs = [
    ...(await query({ topic0: APPROVAL_TOPIC })),
    ...(await query({ topic0: APPROVAL_FOR_ALL_TOPIC })),
    ...(await query({ topic0: PERMIT2_APPROVAL_TOPIC, address: PERMIT2 }))
  ];
  const approvals = await confirmApprovals(provider, address, parseApprovalLogs(logs));
  return { approvals, truncated: budget.truncated };
}

/**
 * Checks one token and spender entered by hand (chains without Blockscout). A pair can hold
 * more than one kind at once, for example an ERC-20 allowance and a Permit2 allowance.
 * @returns {Promise<object[]>} Active approvals for the pair; empty if there are none
 */
export async function checkApproval(provider, owner, token, spender) {
  return confirmApprovals(provider, owner, [
    { kind: 'erc20', token, spender },
    { kind: 'operator', token, spender },
    { kind: 'permit2', token, spender }
  ]);
}
