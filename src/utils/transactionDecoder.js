/**
 * Transaction Decoder Utilities
 * Decodes transaction data from pasted transaction data
 */

import { ethers } from 'ethers';

/**
 * Decode transaction data
 * @param {string} contractAddress - Contract address
 * @param {Array} abi - Contract ABI
 * @param {string} data - Transaction data (hex string)
 * @returns {object} Decoded transaction information
 */
export function decodeTransaction(contractAddress, abi, data) {
  try {
    const iface = new ethers.Interface(abi);
    const decoded = iface.parseTransaction({ data });

    return {
      contractAddress,
      functionName: decoded.name,
      args: decoded.args.map(arg => {
        // Convert BigNumber to string for display
        if (ethers.isBigNumberish(arg)) {
          return arg.toString();
        }
        return arg;
      }),
      signature: decoded.signature,
      fragment: decoded.fragment
    };
  } catch (error) {
    throw new Error(`Failed to decode transaction: ${error.message}`);
  }
}

/**
 * Parse transaction data from various formats
 * @param {string} input - Transaction data (can be hex string, JSON, etc.)
 * @returns {object} Parsed transaction data
 */
export function parseTransactionInput(input) {
  const trimmed = input.trim();
  
  // Try to parse as JSON first
  try {
    const json = JSON.parse(trimmed);
    if (json.data || json.input) {
      return {
        to: json.to || json.toAddress || json.to_address,
        data: json.data || json.input || json.dataHex,
        value: json.value || json.valueHex || '0',
        from: json.from || json.fromAddress || json.from_address
      };
    }
  } catch (e) {
    // Not JSON, continue
  }

  // Try to parse as hex string directly
  if (trimmed.startsWith('0x') && trimmed.length > 10) {
    return {
      data: trimmed,
      value: '0'
    };
  }

  // Try to extract from text that might contain hex
  const hexMatch = trimmed.match(/0x[a-fA-F0-9]{8,}/);
  if (hexMatch) {
    return {
      data: hexMatch[0],
      value: '0'
    };
  }

  throw new Error('Unable to parse transaction data. Please provide hex data (0x...) or JSON format.');
}

/**
 * Extract contract address from transaction
 * @param {object} tx - Transaction object
 * @returns {string} Contract address
 */
export function extractContractAddress(tx) {
  if (tx.to) {
    return tx.to;
  }
  throw new Error('Contract address not found in transaction data');
}

/**
 * Decode transaction and match with ABI
 * @param {string} input - Transaction input (hex or JSON)
 * @param {Array} contracts - Array of {address, abi, name} objects
 * @returns {object} Decoded transaction with matched contract
 */
export function decodeTransactionWithContracts(input, contracts) {
  const parsed = parseTransactionInput(input);
  const contractAddress = extractContractAddress(parsed);

  // Find matching contract
  const contract = contracts.find(c => 
    c.address.toLowerCase() === contractAddress.toLowerCase()
  );

  if (!contract) {
    throw new Error(`No matching contract found for address ${contractAddress}. Please load the contract with this address first.`);
  }

  // Ensure data is a valid hex string
  let data = parsed.data;
  if (!data.startsWith('0x')) {
    // Try to extract hex from the input
    const hexMatch = input.match(/0x[a-fA-F0-9]{8,}/);
    if (hexMatch) {
      data = hexMatch[0];
    } else {
      throw new Error('Invalid transaction data format. Expected hex string starting with 0x.');
    }
  }

  const decoded = decodeTransaction(contractAddress, contract.abi, data);

  return {
    ...decoded,
    contractName: contract.name,
    value: parsed.value,
    from: parsed.from,
    data: data // Include the original data
  };
}
