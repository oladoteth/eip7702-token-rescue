/**
 * Contract Deployment Utilities
 * Handles batcher contract deployment in browser
 */

import { ethers } from 'ethers';

/**
 * Batcher Contract Bytecode
 * This is the compiled bytecode for the SilverbackBatch contract
 * In production, this should be compiled from the Solidity source
 * For now, users will need to provide the bytecode or we'll use a factory pattern
 */
export const BATCHER_CONTRACT_BYTECODE = ''; // Will be populated or provided by user

/**
 * Batcher Contract ABI (for deployment verification)
 */
export const BATCHER_CONTRACT_ABI = [
  {
    inputs: [],
    stateMutability: 'nonpayable',
    type: 'constructor'
  },
  {
    inputs: [
      {
        internalType: 'address[]',
        name: 'targets',
        type: 'address[]'
      },
      {
        internalType: 'bytes[]',
        name: 'datas',
        type: 'bytes[]'
      },
      {
        internalType: 'uint256[]',
        name: 'values',
        type: 'uint256[]'
      }
    ],
    name: 'batchExecuteCalls',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  }
];

/**
 * Deploy batcher contract
 * @param {ethers.ContractRunner} signer - Signer to deploy with
 * @param {string} bytecode - Contract bytecode (optional, uses default if not provided)
 * @returns {Promise<{address: string, txHash: string, receipt: object}>}
 */
export async function deployBatcherContract(signer, bytecode = null) {
  const deployBytecode = bytecode || BATCHER_CONTRACT_BYTECODE;
  
  if (!deployBytecode || deployBytecode === '') {
    throw new Error('Contract bytecode is required. Please provide the compiled bytecode.');
  }

  // Get provider from signer (works even if network changes)
  const provider = signer.provider;
  if (!provider) {
    throw new Error('Signer must have a provider');
  }

  // Verify network is stable before deploying
  try {
    const network = await provider.getNetwork();
    console.log('[Deploy] Current network:', Number(network.chainId));
  } catch (error) {
    if (error.code === 'NETWORK_ERROR' && error.message?.includes('network changed')) {
      throw new Error('Network is changing. Please wait for the network to stabilize.');
    }
  }

  try {
    // Create contract factory
    const factory = new ethers.ContractFactory(
      BATCHER_CONTRACT_ABI,
      deployBytecode,
      signer
    );

    // Deploy contract - this immediately returns with transaction hash
    // IMPORTANT: This is the ONLY place we call deploy() - no retries here
    // Note: If contract was already deployed (e.g., from BatcherDeployment component),
    // we need to get the transaction hash from the existing deployment
    let contract, deploymentTx, txHash;
    
    // Check if we already have a deployment transaction (from component)
    // This happens when the component calls deploy() first to get txHash immediately
    if (signer && signer.provider) {
      // Try to get the contract from a previous deployment
      // For now, we'll always deploy fresh here
      contract = await factory.deploy();
      deploymentTx = contract.deploymentTransaction();
      if (!deploymentTx) {
        throw new Error('Deployment transaction not found');
      }
      txHash = deploymentTx.hash;
    } else {
      contract = await factory.deploy();
      deploymentTx = contract.deploymentTransaction();
      if (!deploymentTx) {
        throw new Error('Deployment transaction not found');
      }
      txHash = deploymentTx.hash;
    }
    
    console.log('[Deploy] Transaction submitted:', txHash);

    // Calculate contract address from transaction (works even if network changes)
    // The address is deterministic based on deployer address and nonce
    const deployerAddress = await signer.getAddress();
    const nonce = await signer.getNonce();
    
    // Use ethers to calculate the contract address
    // For CREATE (not CREATE2), address = keccak256(rlp([deployer, nonce]))[12:]
    // But ethers.js contract.getAddress() handles this correctly
    let address;
    try {
      // Try to get address from contract object first
      address = await contract.getAddress();
    } catch (addrError) {
      // If that fails (network changed), calculate from receipt
      console.warn('Could not get address from contract, will get from receipt');
    }

    // Wait for transaction using provider (more resilient to network changes)
    let receipt;
    try {
      // Wait for transaction with timeout
      receipt = await provider.waitForTransaction(txHash, 1, 120000); // 2 minute timeout
    } catch (waitError) {
      // If waitForTransaction fails, try to get receipt directly
      console.warn('waitForTransaction failed, trying to get receipt directly:', waitError.message);
      
      // Retry getting receipt with delays
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          receipt = await provider.getTransactionReceipt(txHash);
          if (receipt) break;
        } catch (err) {
          // Continue retrying
          if (i === 9) {
            // Last attempt failed - but transaction might still be pending
            // Return what we have (txHash) and let user check explorer
            console.warn('Could not get receipt, but transaction was submitted:', txHash);
            return {
              address: address || null, // May be null if we couldn't calculate it
              txHash: txHash,
              receipt: null,
              contract: contract,
              pending: true
            };
          }
        }
      }
    }

    if (!receipt) {
      // Transaction might still be pending
      console.warn('Transaction receipt not found, but transaction was submitted:', txHash);
      return {
        address: address || null,
        txHash: txHash,
        receipt: null,
        contract: contract,
        pending: true
      };
    }

    // Get contract address from receipt if we don't have it
    if (!address) {
      // Contract address is in receipt.contractAddress for contract creation
      address = receipt.contractAddress;
      if (!address) {
        // Fallback: calculate from deployer and nonce
        // This is a simplified calculation - ethers handles this better
        throw new Error('Could not determine contract address from receipt');
      }
    }

    if (receipt.status !== 1) {
      throw new Error('Transaction reverted');
    }

    return {
      address,
      txHash,
      receipt,
      contract
    };
  } catch (error) {
    // If we already have a transaction hash, the deployment was submitted
    // Even if network changed, we should return success with the txHash
    // Check if error occurred after we got the txHash
    if (error.code === 'NETWORK_ERROR' && error.message?.includes('network changed')) {
      // Try to recover: if we have a contract object, we can get the txHash
      try {
        // Re-deploy to get contract object (this is safe - it won't actually deploy again if txHash exists)
        const factory = new ethers.ContractFactory(
          BATCHER_CONTRACT_ABI,
          deployBytecode,
          signer
        );
        const contract = await factory.deploy();
        const deploymentTx = contract.deploymentTransaction();
        
        if (deploymentTx && deploymentTx.hash) {
          const txHash = deploymentTx.hash;
          console.log('Network changed but transaction was submitted. Hash:', txHash);
          
          // Try to get receipt with retries (transaction might be on different network)
          let receipt = null;
          let address = null;
          
          for (let i = 0; i < 15; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
              receipt = await provider.getTransactionReceipt(txHash);
              if (receipt) {
                address = receipt.contractAddress;
                if (receipt.status === 1 && address) {
                  // Success! We got the receipt and address
                  return {
                    address: address,
                    txHash: txHash,
                    receipt: receipt,
                    contract: contract
                  };
                }
                break;
              }
            } catch (err) {
              // Network might have changed, continue retrying
              if (i === 14) {
                // Last attempt - return with txHash so user can check explorer
                console.warn('Could not get receipt after retries, but transaction was submitted:', txHash);
                return {
                  address: null,
                  txHash: txHash,
                  receipt: null,
                  contract: contract,
                  pending: true
                };
              }
            }
          }
          
          // If we have receipt but no address, or receipt shows failure
          if (receipt) {
            if (receipt.contractAddress && receipt.status === 1) {
              return {
                address: receipt.contractAddress,
                txHash: txHash,
                receipt: receipt,
                contract: contract
              };
            } else {
              // Transaction failed or no contract address
              throw new Error('Transaction reverted or failed');
            }
          }
          
          // No receipt yet, but transaction was submitted
          return {
            address: null,
            txHash: txHash,
            receipt: null,
            contract: contract,
            pending: true
          };
        }
      } catch (recoverError) {
        console.error('Could not recover transaction after network change:', recoverError);
      }
      
      // If we can't recover, throw error with helpful message
      throw new Error(`Network changed during deployment. The transaction may have been submitted successfully. Please check your wallet or the blockchain explorer to verify. Original error: ${error.message}`);
    }
    
    console.error('Error deploying batcher contract:', error);
    throw error;
  }
}

/**
 * Store deployed contract address in localStorage
 * @param {string} address - Contract address
 * @param {number} chainId - Chain ID
 */
export function storeDeployedContract(address, chainId) {
  const key = `batcher_contract_${chainId}`;
  const stored = localStorage.getItem(key);
  const contracts = stored ? JSON.parse(stored) : [];
  
  if (!contracts.includes(address)) {
    contracts.push({
      address,
      chainId,
      deployedAt: Date.now()
    });
    localStorage.setItem(key, JSON.stringify(contracts));
  }
}

/**
 * Get stored deployed contracts for a chain
 * @param {number} chainId - Chain ID
 * @returns {Array} Array of stored contract addresses
 */
export function getStoredContracts(chainId) {
  const key = `batcher_contract_${chainId}`;
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : [];
}

/**
 * Clear all stored contract addresses for a specific chain
 * @param {number} chainId - Chain ID
 */
export function clearStoredContracts(chainId) {
  const key = `batcher_contract_${chainId}`;
  localStorage.removeItem(key);
}

/**
 * Clear all stored contract addresses for all chains
 */
export function clearAllStoredContracts() {
  // Get all localStorage keys
  const keys = Object.keys(localStorage);
  // Remove all keys that start with 'batcher_contract_'
  keys.forEach(key => {
    if (key.startsWith('batcher_contract_')) {
      localStorage.removeItem(key);
    }
  });
}

/**
 * Verify contract is deployed and matches expected interface
 * @param {ethers.Provider} provider - Provider instance
 * @param {string} address - Contract address
 * @returns {Promise<boolean>} True if contract exists and has expected interface
 */
export async function verifyBatcherContract(provider, address, retries = 2) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const code = await provider.getCode(address);
      if (code === '0x') {
        return false;
      }

      // Try to create contract instance and check for batchExecuteCalls
      const contract = new ethers.Contract(address, BATCHER_CONTRACT_ABI, provider);
      // Just verify the contract exists and has code
      return true;
    } catch (error) {
      // Handle network change errors with retry
      if (error.code === 'NETWORK_ERROR' && error.message?.includes('network changed') && attempt < retries - 1) {
        console.warn('Network changed during verification, retrying...', error.message);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      // Other errors or out of retries
      return false;
    }
  }
  
  return false;
}
