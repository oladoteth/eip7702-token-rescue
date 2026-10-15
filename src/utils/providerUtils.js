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
      const provider = new ethers.JsonRpcProvider(url);
      
      // Test the provider by getting the network
      const network = await Promise.race([
        provider.getNetwork(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('RPC timeout')), 5000)
        )
      ]);
      
      // Verify chain ID matches
      if (Number(network.chainId) !== chainId) {
        throw new Error(`Chain ID mismatch: expected ${chainId}, got ${Number(network.chainId)}`);
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

