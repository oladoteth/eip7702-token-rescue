/**
 * Provider Utilities
 * Handles provider creation with fallback RPC endpoints and retry logic
 */

import { ethers } from 'ethers';

/**
 * Create a provider with fallback RPC endpoints
 * Tries each RPC URL in order until one succeeds
 * @param {string|string[]} rpcUrls - Single RPC URL or array of fallback URLs
 * @param {number} chainId - Chain ID for verification
 * @returns {Promise<ethers.JsonRpcProvider>} Provider instance
 */
export async function createProviderWithFallback(rpcUrls, chainId) {
  const urls = Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls];
  
  let lastError = null;
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      console.log(`[ProviderUtils] Trying RPC endpoint ${i + 1}/${urls.length}: ${url}`);
      // cacheTimeout -1: never reuse a cached nonce, balance or code read after a tx.
      // staticNetwork: the chain id is checked below, so ethers need not poll for it.
      const provider = new ethers.JsonRpcProvider(url, chainId, { cacheTimeout: -1, staticNetwork: true });
      
      // Ask the RPC directly: with staticNetwork, getNetwork() would only echo `chainId`.
      const reported = await Promise.race([
        provider.send('eth_chainId', []),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('RPC timeout')), 5000)
        )
      ]);

      // Verify chain ID matches
      if (Number(reported) !== chainId) {
        provider.destroy();
        throw new Error(`Chain ID mismatch: expected ${chainId}, got ${Number(reported)}`);
      }
      
      console.log(`[ProviderUtils] Successfully connected to RPC: ${url}`);
      return provider;
    } catch (error) {
      console.warn(`[ProviderUtils] RPC endpoint failed (${url}):`, error.message);
      lastError = error;
      
      // If this is the last URL, throw the error
      if (i === urls.length - 1) {
        throw new Error(`All RPC endpoints failed. Last error: ${lastError.message}`);
      }
      
      // Wait a bit before trying next endpoint
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  throw lastError || new Error('Failed to create provider');
}

/**
 * Execute a provider operation with retry and fallback
 * @param {ethers.Provider} provider - Provider instance
 * @param {Function} operation - Async function that uses the provider
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<any>} Operation result
 */
export async function executeWithRetry(provider, operation, maxRetries = 3) {
  let lastError = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation(provider);
    } catch (error) {
      lastError = error;
      
      // Check if it's a connection error
      const isConnectionError = 
        error.message?.includes('Failed to fetch') ||
        error.message?.includes('ERR_CONNECTION_CLOSED') ||
        error.message?.includes('network error') ||
        error.code === 'NETWORK_ERROR' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT';
      
      if (isConnectionError && attempt < maxRetries - 1) {
        console.warn(`[ProviderUtils] Operation failed (attempt ${attempt + 1}/${maxRetries}), retrying...`, error.message);
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      
      // If not a connection error or last attempt, throw immediately
      throw error;
    }
  }
  
  throw lastError || new Error('Operation failed after retries');
}


/**
 * Picks the first RPC that both answers for `chainId` and simulates EIP-7702. An RPC that
 * drops authorizations from eth_estimateGas would make the gas estimate and the pre-send
 * safety simulation run without the delegation, so it is skipped when a better one exists.
 * @param {string[]} rpcUrls - In order of preference
 * @param {number} chainId
 * @param {(provider: ethers.JsonRpcProvider) => Promise<{supported: boolean|null, reason: string}>} probe
 * @returns {Promise<{provider: ethers.JsonRpcProvider, url: string, eip7702: {supported: boolean|null, reason: string}}>}
 *   When no RPC supports 7702, returns the first reachable one with supported false.
 */
export async function selectRescueProvider(rpcUrls, chainId, probe) {
  let fallback = null;
  let lastError = null;

  for (const url of rpcUrls) {
    let provider;
    try {
      provider = await createProviderWithFallback([url], chainId);
    } catch (error) {
      lastError = error;
      continue;
    }
    const eip7702 = await probe(provider);
    if (eip7702.supported) {
      fallback?.provider.destroy();
      return { provider, url, eip7702 };
    }
    console.warn(`[ProviderUtils] ${url} does not simulate EIP-7702: ${eip7702.reason}`);
    if (!fallback) {
      fallback = { provider, url, eip7702 };
    } else {
      provider.destroy();
    }
  }

  if (fallback) return fallback;
  throw new Error(`All RPC endpoints failed. Last error: ${lastError?.message}`);
}
