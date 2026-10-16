/**
 * Protocol position adapters. Each adapter reads positions on-chain (no API) and builds the
 * calls that release them to the safe wallet. Add a protocol by adding an adapter here.
 *
 * Adapter shape:
 *   { id, name, supports(chainId) -> bool,
 *     detect({ chainId, provider, address }) -> Position[],
 *     buildCalls(position, actionId, { from, to }) -> Call[] }
 */

import { lido } from './lido.js';
import { aave } from './aave.js';
import { uniswapV3 } from './uniswapV3.js';

export const ADAPTERS = [lido, aave, uniswapV3];

/**
 * Chain id the adapters should use. A local fork can stand in for another chain.
 * @param {object} network - Entry from networks.js
 * @returns {number}
 */
export function positionsChainId(network) {
  return network?.positionsChainId ?? network?.chainId;
}

/**
 * @param {object} network
 * @returns {object[]} Adapters that cover this chain
 */
export function adaptersFor(network) {
  const chainId = positionsChainId(network);
  return ADAPTERS.filter((adapter) => adapter.supports(chainId));
}

/**
 * Runs every adapter for the chain. One adapter failing does not hide the others.
 * @returns {Promise<{positions: object[], errors: Array<{adapter: string, message: string}>}>}
 */
export async function scanPositions({ network, provider, address }) {
  const chainId = positionsChainId(network);
  const results = await Promise.allSettled(adaptersFor(network).map((adapter) => adapter.detect({ chainId, provider, address })));
  const positions = [];
  const errors = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') positions.push(...result.value);
    else errors.push({ adapter: adaptersFor(network)[i].name, message: result.reason?.shortMessage || result.reason?.message || String(result.reason) });
  });
  return { positions, errors };
}

/**
 * @param {object} position - From scanPositions
 * @param {string} actionId - One of position.actions
 * @param {{from: string, to: string}} wallets - Compromised and safe wallet addresses
 * @returns {object[]} Batch calls
 */
export function buildPositionCalls(position, actionId, wallets) {
  const adapter = ADAPTERS.find((a) => a.id === position.adapter);
  if (!adapter) throw new Error(`No adapter for ${position.adapter}`);
  return adapter.buildCalls(position, actionId, wallets);
}
