/**
 * Contract Utilities
 * Handles contract interactions, ABI management, and batch building
 */

import { ethers } from 'ethers';

/**
 * Standard ERC20 ABI
 */
export const ERC20_ABI = [
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'name',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'account', type: 'address' }
    ],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'recipient', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'transfer',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function'
  }
];

/**
 * Standard ERC721 ABI
 */
export const ERC721_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' }
    ],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'uint256', name: 'index', type: 'uint256' }
    ],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' }
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'from', type: 'address' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' }
    ],
    name: 'transferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
];

/**
 * Parse ABI from JSON string, JavaScript object notation, or array
 * @param {string|Array} abiInput - ABI as JSON string, JavaScript object notation, or array
 * @returns {Array} Parsed ABI
 */
export function parseABI(abiInput) {
  // If already an array, return it
  if (Array.isArray(abiInput)) {
    return abiInput;
  }

  // If not a string, throw error
  if (typeof abiInput !== 'string') {
    throw new Error('ABI must be a string or array');
  }

  // Trim whitespace
  const trimmed = abiInput.trim();
  
  // Try parsing as JSON first (most common case)
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('ABI must be an array');
    }
    return parsed;
  } catch (jsonError) {
    // If JSON parsing fails, try parsing as JavaScript object notation
    // This handles cases where keys are not quoted (e.g., { inputs: [] } instead of { "inputs": [] })
    try {
      // Use Function constructor to safely evaluate JavaScript object notation
      // This is safer than eval as it creates a new function scope
      // Note: This only works for valid JavaScript object/array literals
      const parsed = new Function('return ' + trimmed)();
      
      if (!Array.isArray(parsed)) {
        throw new Error('ABI must be an array');
      }
      
      return parsed;
    } catch (jsError) {
      // If both fail, provide a helpful error message
      throw new Error(`Invalid ABI format: ${jsonError.message}. Please ensure the ABI is valid JSON or JavaScript object notation.`);
    }
  }
}

/**
 * Encode function call
 * @param {Array} abi - Contract ABI
 * @param {string} functionName - Function name
 * @param {Array} params - Function parameters
 * @returns {string} Encoded function data
 */
export function encodeFunctionCall(abi, functionName, params = []) {
  const iface = new ethers.Interface(abi);
  return iface.encodeFunctionData(functionName, params);
}

/**
 * Get token balance
 * @param {ethers.Provider} provider - Provider instance
 * @param {string} tokenAddress - Token contract address
 * @param {string} ownerAddress - Owner address
 * @returns {Promise<bigint>} Token balance
 */
export async function getTokenBalance(provider, tokenAddress, ownerAddress) {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return await contract.balanceOf(ownerAddress);
}

/**
 * Get NFT balance
 * @param {ethers.Provider} provider - Provider instance
 * @param {string} nftAddress - NFT contract address
 * @param {string} ownerAddress - Owner address
 * @returns {Promise<bigint>} NFT balance
 */
export async function getNFTBalance(provider, nftAddress, ownerAddress) {
  const contract = new ethers.Contract(nftAddress, ERC721_ABI, provider);
  return await contract.balanceOf(ownerAddress);
}
