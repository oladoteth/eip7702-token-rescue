/**
 * Keys for what each batch call moves, so the same asset is never moved twice.
 * Two calls moving one asset would make the second revert, and with it the whole batch.
 */

import { nftKey } from '../discovery/balances.js';

/**
 * @param {string} token - ERC-20 address
 * @returns {string}
 */
export function erc20Key(token) {
  return `erc20:${token.toLowerCase()}`;
}

export { nftKey };

/**
 * Every asset key covered by the calls in a batch.
 * @param {Array} calls - Batch calls
 * @returns {Set<string>}
 */
export function coveredKeys(calls) {
  const keys = new Set();
  for (const call of calls) {
    if (call.source === 'erc20') keys.add(erc20Key(call.target));
    for (const key of call.nftKeys ?? []) keys.add(key);
    for (const key of call.covers ?? []) keys.add(key);
  }
  return keys;
}
