/**
 * Chain Management Utilities
 * Handles chain switching and adding
 */

import { getAllNetworks, getNetworkByChainId } from './networks';

/**
 * Switch to a specific chain on injected wallet
 * @param {number} chainId - Target chain ID
 * @returns {Promise<void>}
 */
export async function switchToChain(chainId) {
  if (!window.ethereum) {
    throw new Error('No injected wallet found');
  }

  const network = getNetworkByChainId(chainId);
  if (!network) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  try {
    // Try to switch
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }]
    });
  } catch (error) {
    // If chain not added, add it
    if (error.code === 4902) {
      await addChainToWallet(network);
    } else {
      throw error;
    }
  }
}

/**
 * Add chain to wallet
 * @param {object} network - Network configuration
 * @returns {Promise<void>}
 */
export async function addChainToWallet(network) {
  if (!window.ethereum) {
    throw new Error('No injected wallet found');
  }

  await window.ethereum.request({
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: `0x${network.chainId.toString(16)}`,
      chainName: network.name,
      nativeCurrency: network.nativeCurrency,
      rpcUrls: [network.rpcUrl],
      blockExplorerUrls: [network.explorer]
    }]
  });
}

/**
 * Get current chain from wallet
 * @returns {Promise<number>} Current chain ID
 */
export async function getCurrentChain() {
  if (!window.ethereum) {
    throw new Error('No injected wallet found');
  }

  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  return parseInt(chainId, 16);
}

/**
 * Get all available networks
 * @returns {Array} Array of network objects
 */
export function getAvailableNetworks() {
  return getAllNetworks();
}
