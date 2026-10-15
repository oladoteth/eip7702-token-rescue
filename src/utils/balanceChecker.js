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

/**
 * Get fee data with fallback for networks that don't support maxPriorityFeePerGas
 */
async function getFeeDataSafe(provider) {
  try {
    const feeData = await executeWithRetry(
      provider,
      async (p) => await p.getFeeData(),
      3
    );
    
    // If maxPriorityFeePerGas is null/undefined, some networks don't support it
    if (!feeData.maxPriorityFeePerGas) {
      if (feeData.gasPrice) {
        return {
          ...feeData,
          maxFeePerGas: feeData.gasPrice || ethers.parseUnits('1', 'gwei'),
          maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei')
        };
      } else {
        return {
          ...feeData,
          maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits('1', 'gwei'),
          maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei')
        };
      }
    }
    
    return feeData;
  } catch (error) {
    // If getFeeData fails (e.g., eth_maxPriorityFeePerGas not supported), use fallback
    if (error.message?.includes('maxPriorityFeePerGas') || error.code === -32601) {
      console.warn('[balanceChecker] Network does not support maxPriorityFeePerGas, using fallback');
      try {
        const block = await executeWithRetry(
          provider,
          async (p) => await p.getBlock('latest'),
          3
        );
        const gasPrice = block?.baseFeePerGas 
          ? block.baseFeePerGas * 2n 
          : ethers.parseUnits('1', 'gwei');
        
        return {
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
          gasPrice: gasPrice
        };
      } catch (fallbackError) {
        return {
          maxFeePerGas: ethers.parseUnits('1', 'gwei'),
          maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
          gasPrice: ethers.parseUnits('1', 'gwei')
        };
      }
    }
    throw error;
  }
}

/**
 * Estimate transaction cost
 * Uses provider for network stability
 * @param {ethers.Provider} provider - Provider instance
 * @param {object} txRequest - Transaction request
 * @returns {Promise<object>} Estimated cost
 */
export async function estimateTransactionCost(provider, txRequest) {
  if (!provider) {
    throw new Error('Provider is required');
  }

  try {
    // Get fee data with safe fallback
    const feeData = await getFeeDataSafe(provider);
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei');

    // Use provided gasLimit if available, otherwise estimate
    let gasLimit;
    if (txRequest.gasLimit) {
      // Use the provided gas limit (already includes buffer)
      gasLimit = BigInt(txRequest.gasLimit);
    } else {
      // Estimate gas if not provided
      try {
        gasLimit = await executeWithRetry(
          provider,
          async (p) => await p.estimateGas(txRequest),
          3
        );
      } catch (error) {
        // If estimation fails, use a default
        console.warn('[estimateTransactionCost] Gas estimation failed, using default:', error);
        gasLimit = 500000n;
      }
    }

    // Calculate total cost
    const totalCost = gasLimit * gasPrice;

    return {
      gasLimit,
      gasPrice,
      totalCost,
      formatted: ethers.formatEther(totalCost)
    };
  } catch (error) {
    console.error('[estimateTransactionCost] Error:', error);
    throw error;
  }
}
