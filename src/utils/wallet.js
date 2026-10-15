/**
 * Wallet Connection Utilities
 * Supports injected wallets (MetaMask, etc.)
 */

import { ethers } from 'ethers';

/**
 * Check if MetaMask or other injected wallet is available
 */
export function hasInjectedWallet() {
  return typeof window !== 'undefined' && window.ethereum;
}

/**
 * Connect to injected wallet (MetaMask, etc.)
 * @returns {Promise<{address: string, provider: ethers.BrowserProvider, signer: ethers.JsonRpcSigner}>}
 */
export async function connectInjectedWallet() {
  if (!hasInjectedWallet()) {
    throw new Error('No injected wallet found. Please install MetaMask or another Web3 wallet.');
  }

  try {
    // Request account access
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    
    if (accounts.length === 0) {
      throw new Error('No accounts found');
    }

    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    const network = await provider.getNetwork();

    return {
      address,
      provider,
      signer,
      chainId: Number(network.chainId),
      isInjected: true
    };
  } catch (error) {
    if (error.code === 4001) {
      throw new Error('User rejected connection request');
    }
    throw error;
  }
}

/**
 * Switch network on injected wallet
 * @param {number} chainId - Target chain ID
 */
export async function switchNetwork(chainId) {
  if (!hasInjectedWallet()) {
    throw new Error('No injected wallet found');
  }

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }]
    });
  } catch (error) {
    if (error.code === 4902) {
      throw new Error(`Chain ${chainId} not added to wallet. Please add it manually.`);
    }
    throw error;
  }
}

/**
 * Get current connected wallet address
 */
export async function getCurrentWalletAddress() {
  if (hasInjectedWallet()) {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    return await signer.getAddress();
  }
  return null;
}
