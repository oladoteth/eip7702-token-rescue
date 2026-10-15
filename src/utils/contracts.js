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
 * Parse an ABI pasted by the user. Accepts a JSON ABI array, or human-readable
 * signatures one per line (for example `function transfer(address to, uint256 amount)`).
 * The input is never evaluated as code: this page holds private keys.
 * @param {string|Array} abiInput - ABI as JSON string, human-readable signatures, or array
 * @returns {Array} ABI in JSON form
 */
export function parseABI(abiInput) {
  if (Array.isArray(abiInput)) {
    return abiInput;
  }
  if (typeof abiInput !== 'string') {
    throw new Error('ABI must be a string or array');
  }

  const trimmed = abiInput.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Invalid JSON ABI: ${error.message}`);
    }
    // Accept a full compiler artifact as well as a bare ABI array.
    const abi = Array.isArray(parsed) ? parsed : parsed?.abi;
    if (!Array.isArray(abi)) {
      throw new Error('ABI must be a JSON array');
    }
    return abi;
  }

  const lines = trimmed
    .split('\n')
    .map((line) => line.trim().replace(/[;,]$/, ''))
    .filter(Boolean);
  // Fragment.from throws on bad input. ethers.Interface would skip bad lines with only
  // a console warning, so a typo would silently drop a function.
  const fragments = lines.map((line, index) => {
    try {
      return ethers.Fragment.from(line);
    } catch (error) {
      throw new Error(
        `Invalid ABI on line ${index + 1}: "${line}". Paste a JSON ABI array or one human-readable signature per line. (${error.shortMessage || error.message})`
      );
    }
  });
  return JSON.parse(new ethers.Interface(fragments).formatJson());
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
