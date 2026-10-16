/**
 * Balance Checking Utilities
 */

import { ethers } from 'ethers';
import { executeWithRetry } from './providerUtils';

/**
 * Get wallet balance using provider
 * @param {ethers.Provider} provider - Provider instance
 * @param {string} address - Wallet address
 * @returns {Promise<{balance: bigint, formatted: string, hasBalance: boolean}>}
 */
export async function getWalletBalance(provider, address) {
  if (!provider) {
    throw new Error('Provider is required');
  }
  
  if (!address || !ethers.isAddress(address)) {
    throw new Error('Valid wallet address is required');
  }
  
  try {
    const balance = await executeWithRetry(
      provider,
      async (p) => await p.getBalance(address),
      3
    );
    return {
      balance,
      formatted: ethers.formatEther(balance),
      hasBalance: balance > 0n
    };
  } catch (error) {
    // Provider handles network changes
    // Just throw the error - let the caller handle it
    console.error('[getWalletBalance] Error:', error);
    throw error;
  }
}

/**
 * Check if balance is sufficient for transaction
 * @param {bigint} balance - Current balance
 * @param {bigint} estimatedCost - Estimated transaction cost
 * @returns {object} Check result
 */
export function checkBalanceSufficient(balance, estimatedCost) {
  const isSufficient = balance >= estimatedCost;
  const shortfall = isSufficient ? 0n : estimatedCost - balance;

  return {
    isSufficient,
    shortfall,
    shortfallFormatted: ethers.formatEther(shortfall),
    currentBalance: ethers.formatEther(balance),
    estimatedCost: ethers.formatEther(estimatedCost)
  };
}
