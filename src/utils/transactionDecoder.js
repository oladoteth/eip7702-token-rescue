/**
 * Decodes pasted transaction data (from an explorer, a dapp or a wallet) into a batch call.
 * Nothing pasted is trusted: the calldata must decode exactly against a loaded ABI.
 */

import { ethers } from 'ethers';

/**
 * Parses a transaction `value` in wei. Explorers and wallets give it as hex wei
 * ("0x2386f26fc10000") or decimal wei ("10000000000000000"). A decimal point means the
 * value is not in wei, so it is refused instead of guessed: a wrong guess moves the
 * wrong amount.
 * @param {string|number|bigint|null|undefined} input
 * @returns {bigint}
 */
export function parseWeiValue(input) {
  if (input == null || input === '') return 0n;
  if (typeof input === 'bigint') {
    if (input < 0n) throw new Error('Value cannot be negative');
    return input;
  }
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 0) {
      throw new Error(`Value ${input} is not a whole number of wei. Paste it as a string.`);
    }
    return BigInt(input);
  }
  const text = String(input).trim();
  if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(text);
  if (/^\d+$/.test(text)) return BigInt(text);
  throw new Error(`Value "${text}" is not a whole number of wei (hex like 0x2386f26fc10000, or decimal wei).`);
}

/**
 * Formats a decoded argument for display. Arrays and tuples are shown as JSON.
 */
function formatArg(arg) {
  if (typeof arg === 'bigint') return arg.toString();
  if (Array.isArray(arg)) return JSON.stringify(arg, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  return String(arg);
}

/**
 * Extracts {to, data, value} from pasted text: JSON transaction, or bare hex calldata.
 * @param {string} input
 * @returns {{to: string|null, data: string, value: bigint}}
 */
export function parseTransactionInput(input) {
  const trimmed = input.trim();
  if (trimmed.startsWith('{')) {
    let json;
    try {
      json = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
    const data = json.data ?? json.input ?? json.calldata;
    if (typeof data !== 'string' || !/^0x[0-9a-f]*$/i.test(data) || data.length < 10) {
      throw new Error('The JSON has no valid "data" or "input" field.');
    }
    const to = json.to ?? null;
    if (to != null && !ethers.isAddress(to)) {
      throw new Error(`The "to" field is not an address: ${to}`);
    }
    return { to: to && ethers.getAddress(to), data, value: parseWeiValue(json.value) };
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed) && trimmed.length >= 10 && trimmed.length % 2 === 0) {
    return { to: null, data: trimmed, value: 0n };
  }
  throw new Error('Paste hex calldata (0x...) or a JSON transaction with "to", "data" and "value".');
}

/**
 * Decodes pasted input against the loaded contracts.
 * @param {string} input - Pasted text
 * @param {Array<{address: string, abi: Array, name: string}>} contracts - Loaded contracts
 * @param {string|null} fallbackAddress - Contract to use when the input has no "to"
 * @returns {{target: string, data: string, value: bigint, contractName: string,
 *   functionName: string, signature: string, args: string[]}}
 */
export function decodeTransactionWithContracts(input, contracts, fallbackAddress = null) {
  const parsed = parseTransactionInput(input);
  const target = parsed.to ?? fallbackAddress;
  if (!target) {
    throw new Error('This calldata has no "to" address. Choose which loaded contract it is for.');
  }
  const contract = contracts.find((c) => c.address.toLowerCase() === target.toLowerCase());
  if (!contract) {
    throw new Error(`No loaded contract at ${target}. Load its ABI first.`);
  }

  const iface = new ethers.Interface(contract.abi);
  let decoded;
  try {
    decoded = iface.parseTransaction({ data: parsed.data, value: parsed.value });
  } catch {
    decoded = null;
  }
  if (!decoded) {
    throw new Error(`The calldata does not match any function in the ${contract.name} ABI.`);
  }
  // Re-encode and compare, so extra or malformed bytes cannot ride along unseen.
  const reencoded = iface.encodeFunctionData(decoded.fragment, decoded.args);
  if (reencoded.toLowerCase() !== parsed.data.toLowerCase()) {
    throw new Error('The calldata has extra or malformed bytes after the arguments. Refusing it.');
  }
  if (parsed.value > 0n && !decoded.fragment.payable) {
    throw new Error(`${decoded.name} is not payable, but the transaction sends value.`);
  }

  return {
    target: ethers.getAddress(contract.address),
    data: parsed.data,
    value: parsed.value,
    contractName: contract.name,
    functionName: decoded.name,
    signature: decoded.signature,
    args: decoded.args.map(formatArg)
  };
}
