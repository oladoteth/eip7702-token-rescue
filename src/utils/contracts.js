/**
 * ABI parsing for user-pasted ABIs.
 */

import { ethers } from 'ethers';

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
