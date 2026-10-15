/**
 * Turns discovery candidates into rescuable assets. Pure: no network access.
 */

import { ethers } from 'ethers';

// Tokens worth at least this much are pre-selected.
export const MIN_VALUABLE_USD = 1;

// Airdrop spam advertises a link or a fake claim in its name or symbol. A bare domain is
// not enough: real tokens use them (YFI is named "yearn.finance"), and domain-named scam
// tokens are almost always unpriced, so they are not pre-selected anyway.
const SPAM_PATTERN = /(https?:|www\.|t\.me\/|claim|visit|reward|airdrop|voucher|bonus|gift)/i;

const CATEGORY_ORDER = { valuable: 0, dust: 1, unpriced: 2, spam: 3 };

/**
 * @typedef {object} Asset
 * @property {'ERC-20'} type
 * @property {string} token
 * @property {string} symbol
 * @property {string} name
 * @property {number|null} decimals
 * @property {bigint} balance - On-chain balance, always above zero
 * @property {number|null} priceUsd
 * @property {number|null} valueUsd
 * @property {'valuable'|'dust'|'unpriced'|'spam'} category
 */

/**
 * @param {Array} candidates - From an explorer. Only a hint.
 * @param {Map<string, bigint|null>} balances - On-chain balances by lower-case token address
 * @param {Map<string, number>} prices - Fallback USD prices by lower-case token address
 * @returns {Asset[]} Sorted: valuable by value, then dust, unpriced, spam
 */
export function classifyErc20(candidates, balances, prices) {
  const seen = new Set();
  const assets = [];

  for (const candidate of candidates) {
    if (candidate.type !== 'ERC-20') continue;
    const key = candidate.token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // The chain decides. A stale or faked explorer balance must never become a call.
    const balance = balances.get(key);
    if (typeof balance !== 'bigint' || balance === 0n) continue;

    const priceUsd = candidate.priceUsd ?? prices.get(key) ?? null;
    const valueUsd = priceUsd != null && candidate.decimals != null
      ? Number(ethers.formatUnits(balance, candidate.decimals)) * priceUsd
      : null;

    let category;
    if (SPAM_PATTERN.test(`${candidate.name} ${candidate.symbol}`)) category = 'spam';
    else if (valueUsd == null) category = 'unpriced';
    else if (valueUsd >= MIN_VALUABLE_USD) category = 'valuable';
    else category = 'dust';

    assets.push({ ...candidate, balance, priceUsd, valueUsd, category });
  }

  return assets.sort(
    (a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || (b.valueUsd ?? 0) - (a.valueUsd ?? 0)
  );
}
