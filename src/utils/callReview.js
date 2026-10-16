/**
 * Pre-send review of batch calls.
 * Flags any call that moves assets, or grants control of them, to an address other
 * than the safe wallet. This catches malicious calldata pasted from a fake "helper".
 */

import { ethers } from 'ethers';

const reviewInterface = new ethers.Interface([
  'function transfer(address to, uint256 amount)',
  // ERC-20 and ERC-721 share this selector.
  'function transferFrom(address from, address to, uint256 amountOrId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
  'function approve(address spender, uint256 amountOrId)',
  'function increaseAllowance(address spender, uint256 addedValue)',
  'function setApprovalForAll(address operator, bool approved)',
  // RescueDelegate native sweep, called on the compromised account itself.
  'function sweepNative(address to)'
]);

const RECIPIENT_ARG = {
  transfer: 'to',
  transferFrom: 'to',
  safeTransferFrom: 'to',
  safeBatchTransferFrom: 'to',
  approve: 'spender',
  increaseAllowance: 'spender',
  setApprovalForAll: 'operator',
  sweepNative: 'to'
};

const APPROVALS = new Set(['approve', 'increaseAllowance', 'setApprovalForAll']);

function same(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * @typedef {object} CallReview
 * @property {'ok'|'danger'|'unknown'} level - danger: assets or approvals go to a non-safe address.
 *   unknown: the call cannot be checked automatically.
 * @property {string} action - Short description, for example "transfer" or "native transfer"
 * @property {string|null} recipient - Address that receives assets or control, when known
 * @property {string} message - Explanation shown to the user
 */

/**
 * Classifies one batch call against the safe wallet address.
 * @param {{target: string, value?: bigint, data?: string}} call
 * @param {string} safeAddress
 * @returns {CallReview}
 */
export function reviewCall(call, safeAddress) {
  const data = call.data ?? '0x';
  const value = BigInt(call.value ?? 0);

  if (data === '0x') {
    if (value === 0n) {
      return { level: 'unknown', action: 'empty call', recipient: call.target, message: 'Call with no data and no value.' };
    }
    return same(call.target, safeAddress)
      ? { level: 'ok', action: 'native transfer', recipient: call.target, message: 'Sends native coin to your safe wallet.' }
      : { level: 'danger', action: 'native transfer', recipient: call.target, message: 'Sends native coin to an address that is not your safe wallet.' };
  }

  let parsed = null;
  try {
    parsed = reviewInterface.parseTransaction({ data, value });
  } catch {
    // Unknown selector or malformed arguments.
  }
  if (!parsed) {
    return {
      level: 'unknown',
      action: 'custom call',
      recipient: null,
      message: value > 0n
        ? 'Custom call that also sends native coin. Check where the value goes before sending.'
        : 'Custom call. It cannot be checked automatically, so make sure you trust where it came from.'
    };
  }

  const name = parsed.name;
  const recipient = parsed.args[RECIPIENT_ARG[name]];

  // The decoded arguments say nothing about native value: it goes to the called contract.
  if (value > 0n && !same(call.target, safeAddress)) {
    return {
      level: 'danger',
      action: `${name} with native value`,
      recipient: call.target,
      message: 'Also sends native coin to the called contract, which is not your safe wallet.'
    };
  }

  if (name === 'setApprovalForAll' && !parsed.args.approved) {
    return { level: 'ok', action: 'revoke approval', recipient, message: 'Removes an operator approval.' };
  }
  if (name === 'approve' && recipient === ethers.ZeroAddress) {
    return { level: 'ok', action: 'revoke approval', recipient, message: 'Clears an NFT approval.' };
  }
  if (name === 'approve' && parsed.args.amountOrId === 0n && !same(recipient, safeAddress)) {
    // ERC-20 and ERC-721 share this selector. On an NFT contract, 0 is a token ID, so this
    // would approve token #0 instead of revoking. The target type is not known here.
    return {
      level: 'unknown',
      action: 'approve',
      recipient,
      message: 'Revokes an ERC-20 allowance, but on an NFT contract it approves token #0 for this address. Check the contract type.'
    };
  }

  if (same(recipient, safeAddress)) {
    return {
      level: 'ok',
      action: name,
      recipient,
      message: APPROVALS.has(name)
        ? 'Grants an approval to your safe wallet.'
        : name === 'sweepNative'
          ? 'Sends the whole native coin balance to your safe wallet.'
          : 'Sends assets to your safe wallet.'
    };
  }
  return {
    level: 'danger',
    action: name,
    recipient,
    message: APPROVALS.has(name)
      ? 'Gives another address permission to move these assets. Attackers use this to drain wallets.'
      : 'Sends assets to an address that is not your safe wallet.'
  };
}
