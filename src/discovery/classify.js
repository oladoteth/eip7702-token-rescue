/**
 * Turns discovery candidates into rescuable assets. Pure: no network access.
 */

import { ethers } from 'ethers';
import { nftKey } from './balances.js';

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

/**
 * @typedef {object} NftAsset
 * @property {'ERC-721'|'ERC-1155'} type
 * @property {string} token
 * @property {string} name - Collection name
 * @property {string} symbol
 * @property {bigint} tokenId
 * @property {bigint} amount - Held on-chain, always above zero (1 for ERC-721)
 * @property {'nft'|'spam'} category
 */

/**
 * NFTs have no reliable price, and spam collections copy famous names, so nothing here
 * is pre-selected. Only scam-looking names are split out.
 * @param {Array} candidates - From an explorer. Only a hint.
 * @param {Map<string, bigint|null>} holdings - On-chain amounts by nftKey
 * @returns {NftAsset[]} Sorted: real-looking NFTs by collection, then spam
 */
export function classifyNfts(candidates, holdings) {
  const seen = new Set();
  const assets = [];
  for (const candidate of candidates) {
    if (candidate.type !== 'ERC-721' && candidate.type !== 'ERC-1155') continue;
    const key = nftKey(candidate.token, candidate.tokenId);
    if (seen.has(key)) continue;
    seen.add(key);

    const amount = holdings.get(key);
    if (typeof amount !== 'bigint' || amount === 0n) continue;

    const category = SPAM_PATTERN.test(`${candidate.name} ${candidate.symbol}`) ? 'spam' : 'nft';
    assets.push({ ...candidate, amount, category });
  }
  return assets.sort(
    (a, b) =>
      (a.category === 'spam') - (b.category === 'spam') ||
      a.name.localeCompare(b.name) ||
      (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0)
  );
}
