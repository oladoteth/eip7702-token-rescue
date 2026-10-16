/**
 * Asset discovery for the compromised wallet. Only its address leaves the browser.
 */

import { listBlockscoutTokens, listBlockscoutNfts } from './blockscout.js';
import { fetchLlamaPrices } from './prices.js';
import { readErc20Balances, readNftHoldings } from './balances.js';
import { classifyErc20, classifyNfts } from './classify.js';

/**
 * @param {object} network - Entry from networks.js
 * @returns {boolean} Whether an automatic scan is available on this chain
 */
export function canDiscover(network) {
  return Boolean(network?.discovery?.blockscout);
}

/**
 * Finds the ERC-20 tokens an address holds, verified on-chain and priced in USD.
 * @param {object} params
 * @param {object} params.network - Entry from networks.js
 * @param {string} params.address - Compromised wallet address
 * @param {ethers.Provider} params.provider
 * @param {(stage: string) => void} [params.onProgress]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{assets: import('./classify.js').Asset[], truncated: boolean, skippedUnpriced: boolean, pricesUnavailable: boolean}>}
 */
export async function discoverErc20({ network, address, provider, onProgress = () => {}, signal }) {
  if (!canDiscover(network)) {
    throw new Error(`Automatic scan is not available on ${network?.name ?? 'this chain'}`);
  }

  onProgress('Listing tokens from Blockscout. This can take up to a minute on busy chains...');
  const { candidates, truncated, skippedUnpriced } = await listBlockscoutTokens(network.discovery.blockscout, address, {
    types: ['ERC-20'],
    signal
  });

  onProgress(`Checking ${candidates.length} balances on-chain...`);
  const balances = await readErc20Balances(provider, candidates.map((c) => c.token), address);

  // Only look up prices for held tokens Blockscout did not price.
  const unpriced = candidates
    .filter((c) => c.priceUsd == null && (balances.get(c.token.toLowerCase()) ?? 0n) > 0n)
    .map((c) => c.token);
  let prices = new Map();
  let pricesUnavailable = false;
  if (unpriced.length > 0 && network.discovery.llama) {
    onProgress(`Pricing ${unpriced.length} tokens...`);
    try {
      prices = await fetchLlamaPrices(network.discovery.llama, unpriced, { signal });
    } catch {
      // Prices only affect sorting and pre-selection, so the scan can continue without them.
      pricesUnavailable = true;
    }
  }

  return { assets: classifyErc20(candidates, balances, prices), truncated, skippedUnpriced, pricesUnavailable };
}

/**
 * Finds the NFTs an address holds, each confirmed on-chain.
 * @param {object} params - Same as discoverErc20
 * @returns {Promise<{assets: import('./classify.js').NftAsset[], truncated: boolean}>}
 */
export async function discoverNfts({ network, address, provider, onProgress = () => {}, signal }) {
  if (!canDiscover(network)) {
    throw new Error(`Automatic scan is not available on ${network?.name ?? 'this chain'}`);
  }
  onProgress('Listing NFTs from Blockscout...');
  const { candidates, truncated } = await listBlockscoutNfts(network.discovery.blockscout, address, { signal });
  onProgress(`Confirming ${candidates.length} NFTs on-chain...`);
  const holdings = await readNftHoldings(provider, candidates, address);
  return { assets: classifyNfts(candidates, holdings), truncated };
}
