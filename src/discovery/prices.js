/**
 * USD prices from DefiLlama (free, no key, browser CORS allowed).
 */

const BATCH_SIZE = 50;

/**
 * @param {string} llamaChain - DefiLlama chain id, for example 'ethereum' or 'base'
 * @param {string[]} tokens - Token addresses
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Map<string, number>>} Lower-case token address to USD price.
 *   Tokens DefiLlama does not know are absent.
 */
export async function fetchLlamaPrices(llamaChain, tokens, { signal } = {}) {
  const prices = new Map();
  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const ids = tokens.slice(i, i + BATCH_SIZE).map((token) => `${llamaChain}:${token}`).join(',');
    const response = await fetch(`https://coins.llama.fi/prices/current/${ids}`, { signal });
    if (!response.ok) {
      throw new Error(`DefiLlama returned HTTP ${response.status}`);
    }
    const { coins } = await response.json();
    for (const [id, coin] of Object.entries(coins ?? {})) {
      if (typeof coin.price === 'number') {
        prices.set(id.slice(id.indexOf(':') + 1).toLowerCase(), coin.price);
      }
    }
  }
  return prices;
}
