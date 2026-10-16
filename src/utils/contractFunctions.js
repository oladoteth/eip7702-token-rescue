/**
 * Contract Function Utilities
 * Extract and categorize functions from ABIs
 */

import { ethers } from 'ethers';

// One shared parser, so there is a single place that must never evaluate input.
export { parseABI } from './contracts.js';

/**
 * Get all functions from ABI
 * @param {Array} abi - Contract ABI
 * @returns {Array} Array of function objects
 */
export function getFunctionsFromABI(abi) {
  return abi.filter(item => item.type === 'function');
}

/**
 * Get read functions (view/pure)
 * @param {Array} abi - Contract ABI
 * @returns {Array} Array of read function objects
 */
export function getReadFunctions(abi) {
  return getFunctionsFromABI(abi).filter(
    func => func.stateMutability === 'view' || func.stateMutability === 'pure'
  );
}

/**
 * Get write functions (non-payable, payable)
 * @param {Array} abi - Contract ABI
 * @returns {Array} Array of write function objects
 */
export function getWriteFunctions(abi) {
  return getFunctionsFromABI(abi).filter(
    func => func.stateMutability !== 'view' && func.stateMutability !== 'pure'
  );
}

/**
 * Format function signature for display
 * @param {object} func - Function ABI object
 * @returns {string} Formatted function signature
 */
export function formatFunctionSignature(func) {
  const params = func.inputs.map(input => `${input.type} ${input.name || ''}`).join(', ');
  return `${func.name}(${params})`;
}

/**
 * Canonical signature, for example "safeTransferFrom(address,address,uint256)". Unique per
 * function, unlike the name, which overloads share.
 * @param {object} func - Function ABI object
 * @returns {string}
 */
export function functionSignature(func) {
  return ethers.Fragment.from(func).format('sighash');
}

function coerceParam(input, raw) {
  const label = input.name || input.type;
  const text = String(raw ?? '').trim();
  if (text === '') {
    throw new Error(`Parameter "${label}" is required`);
  }
  if (input.type.endsWith(']') || input.type.startsWith('tuple')) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Parameter "${label}" (${input.type}) must be JSON, for example ["0x...", "0x..."] or [1, 2]`);
    }
  }
  if (input.type === 'bool') {
    if (text !== 'true' && text !== 'false') {
      throw new Error(`Parameter "${label}" must be true or false`);
    }
    return text === 'true';
  }
  // Numbers, addresses and bytes stay strings: ethers validates and converts them exactly.
  return text;
}

/**
 * Builds a batch call from the interactive form.
 * @param {{address: string, abi: Array, name: string}} contract
 * @param {string} signature - From functionSignature
 * @param {Array<string>} rawParams - Form values, in input order
 * @param {string} nativeAmount - Native coin to send with the call, in whole units ("0.5")
 * @returns {object} A batch call
 */
export function buildCustomCall(contract, signature, rawParams, nativeAmount = '0') {
  const iface = new ethers.Interface(contract.abi);
  const fragment = iface.getFunction(signature);
  if (!fragment) {
    throw new Error(`${signature} is not in the ${contract.name} ABI`);
  }
  const params = fragment.inputs.map((input, i) => coerceParam(input, rawParams[i]));

  let data;
  try {
    data = iface.encodeFunctionData(fragment, params);
  } catch (error) {
    const which = error.argument ? ` (${error.argument})` : '';
    throw new Error(`Invalid parameter${which}: ${error.shortMessage || error.message}`);
  }

  let value;
  try {
    value = ethers.parseEther((nativeAmount || '0').trim());
  } catch {
    throw new Error(`Invalid amount "${nativeAmount}". Use a number like 0.5`);
  }
  if (value < 0n) throw new Error('Amount cannot be negative');
  if (value > 0n && !fragment.payable) {
    throw new Error(`${fragment.name} is not payable, so it cannot receive value`);
  }

  const decoded = iface.decodeFunctionData(fragment, data);
  return {
    target: ethers.getAddress(contract.address),
    value,
    data,
    contractName: contract.name,
    functionName: fragment.name,
    args: decoded.map((arg) => (typeof arg === 'bigint' ? arg.toString() : Array.isArray(arg) ? JSON.stringify(arg, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) : String(arg))),
    source: 'custom'
  };
}
