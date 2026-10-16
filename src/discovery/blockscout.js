/**
 * Blockscout token listing (free, no key). Used only as a hint: every balance is
 * re-read on-chain before anything is added to a batch.
 */

import { ethers } from 'ethers';

// 50 items per page. 10 pages covers wallets with heavy airdrop spam.
const MAX_PAGES = 10;
// Pages for wallets with thousands of spam tokens take 70-90 seconds on eth.blockscout.com.
const REQUEST_TIMEOUT_MS = 120000;

function toCandidate(item) {
  const token = item.token;
  return {
    type: token.type,
    token: ethers.getAddress(token.address_hash),
    symbol: token.symbol || '',
    name: token.name || '',
    decimals: token.decimals == null ? null : Number(token.decimals),
    priceUsd: token.exchange_rate == null ? null : Number(token.exchange_rate),
    tokenId: item.token_id ?? null
  };
}

async function fetchPage(url, signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) {
    throw new Error(`Blockscout returned HTTP ${response.status}`);
  }
  return response.json();
}

function pageUrl(baseUrl, path, types, pageParams) {
  const url = new URL(path, baseUrl);
  url.searchParams.set('type', types.join(','));
  for (const [key, value] of Object.entries(pageParams ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

/**
 * Lists tokens an address holds according to a Blockscout instance.
 * @param {string} baseUrl - Instance root, for example https://eth.blockscout.com
 * @param {string} address - Wallet address
 * @param {object} [options]
 * @param {string[]} [options.types] - Token standards, for example ['ERC-20']
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{candidates: Array, truncated: boolean, skippedUnpriced: boolean}>}
 *   truncated: more pages existed than MAX_PAGES. skippedUnpriced: listing stopped
 *   because every remaining token had no market price.
 */
export async function listBlockscoutTokens(baseUrl, address, { types = ['ERC-20'], signal } = {}) {
  const candidates = [];
  let pageParams = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await fetchPage(pageUrl(baseUrl, `/api/v2/addresses/${address}/tokens`, types, pageParams), signal);
    candidates.push(...body.items.map(toCandidate));

    pageParams = body.next_page_params;
    if (!pageParams) {
      return { candidates, truncated: false, skippedUnpriced: false };
    }
    // Results are sorted by USD value, and the cursor carries the last item's value.
    // Once it is zero, the rest have no market price: on a drained wallet that is
    // airdrop spam, and each extra page can take over a minute.
    if (!(Number(pageParams.fiat_value) > 0)) {
      return { candidates, truncated: false, skippedUnpriced: true };
    }
  }
  return { candidates, truncated: true, skippedUnpriced: false };
}

/**
 * Lists individual NFTs (ERC-721 and ERC-1155) an address holds according to Blockscout.
 * @param {string} baseUrl - Instance root
 * @param {string} address - Wallet address
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{candidates: Array<{type: string, token: string, name: string, symbol: string, tokenId: bigint}>, truncated: boolean}>}
 */
export async function listBlockscoutNfts(baseUrl, address, { signal } = {}) {
  const candidates = [];
  let pageParams = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await fetchPage(pageUrl(baseUrl, `/api/v2/addresses/${address}/nft`, ['ERC-721', 'ERC-1155'], pageParams), signal);
    for (const item of body.items) {
      const type = item.token_type ?? item.token?.type;
      if (type !== 'ERC-721' && type !== 'ERC-1155') continue;
      candidates.push({
        type,
        token: ethers.getAddress(item.token.address_hash),
        name: item.token.name || '',
        symbol: item.token.symbol || '',
        tokenId: BigInt(item.id)
      });
    }
    pageParams = body.next_page_params;
    if (!pageParams) {
      return { candidates, truncated: false };
    }
  }
  return { candidates, truncated: true };
}
