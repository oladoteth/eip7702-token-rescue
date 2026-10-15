// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { reviewCall } from '../src/utils/callReview.js';

const SAFE = ethers.Wallet.createRandom().address;
const ATTACKER = ethers.Wallet.createRandom().address;
const COMPROMISED = ethers.Wallet.createRandom().address;
const TOKEN = ethers.Wallet.createRandom().address;

const iface = new ethers.Interface([
  'function transfer(address,uint256)',
  'function transferFrom(address,address,uint256)',
  'function safeTransferFrom(address,address,uint256)',
  'function safeTransferFrom(address,address,uint256,uint256,bytes)',
  'function safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)',
  'function approve(address,uint256)',
  'function setApprovalForAll(address,bool)',
  'function stake(uint256)'
]);
const call = (data, value = 0n, target = TOKEN) => ({ target, data, value });

// The whole point of the review: transfers to the safe pass, anything else is loud.
test('ERC-20 transfer to the safe wallet is ok', () => {
  assert.equal(reviewCall(call(iface.encodeFunctionData('transfer', [SAFE, 1n])), SAFE).level, 'ok');
});

test('ERC-20 transfer to any other address is danger', () => {
  const review = reviewCall(call(iface.encodeFunctionData('transfer', [ATTACKER, 1n])), SAFE);
  assert.equal(review.level, 'danger');
  assert.equal(review.recipient, ATTACKER);
});

test('address comparison ignores checksum casing', () => {
  assert.equal(reviewCall(call(iface.encodeFunctionData('transfer', [SAFE.toLowerCase(), 1n])), SAFE).level, 'ok');
});

test('NFT and multi-token transfers are checked on the "to" argument', () => {
  const toAttacker = [
    iface.encodeFunctionData('transferFrom', [COMPROMISED, ATTACKER, 7n]),
    iface.encodeFunctionData('safeTransferFrom(address,address,uint256)', [COMPROMISED, ATTACKER, 7n]),
    iface.encodeFunctionData('safeTransferFrom(address,address,uint256,uint256,bytes)', [COMPROMISED, ATTACKER, 1n, 5n, '0x']),
    iface.encodeFunctionData('safeBatchTransferFrom', [COMPROMISED, ATTACKER, [1n], [5n], '0x'])
  ];
  for (const data of toAttacker) {
    assert.equal(reviewCall(call(data), SAFE).level, 'danger', data.slice(0, 10));
  }
  assert.equal(reviewCall(call(iface.encodeFunctionData('transferFrom', [COMPROMISED, SAFE, 7n])), SAFE).level, 'ok');
});

// Approvals are the classic drainer trick: nothing moves now, the attacker pulls later.
test('approvals to another address are danger, revocations are ok', () => {
  assert.equal(reviewCall(call(iface.encodeFunctionData('approve', [ATTACKER, ethers.MaxUint256])), SAFE).level, 'danger');
  assert.equal(reviewCall(call(iface.encodeFunctionData('setApprovalForAll', [ATTACKER, true])), SAFE).level, 'danger');
  assert.equal(reviewCall(call(iface.encodeFunctionData('setApprovalForAll', [ATTACKER, false])), SAFE).level, 'ok');
});

test('native coin goes to the safe wallet or is danger', () => {
  assert.equal(reviewCall(call('0x', 1n, SAFE), SAFE).level, 'ok');
  assert.equal(reviewCall(call('0x', 1n, ATTACKER), SAFE).level, 'danger');
});

// Unknown calls must never be reported as safe.
test('unknown calls are unknown, never ok', () => {
  assert.equal(reviewCall(call(iface.encodeFunctionData('stake', [1n])), SAFE).level, 'unknown');
  assert.equal(reviewCall(call('0xdeadbeef'), SAFE).level, 'unknown');
  assert.equal(reviewCall(call('0x', 0n), SAFE).level, 'unknown');
});

// Bypass: a token call to the safe wallet that also carries native value to the target.
// The value goes to whatever contract is called, which may be the attacker's.
test('native value attached to a decoded call to a non-safe target is danger', () => {
  const review = reviewCall(call(iface.encodeFunctionData('transfer', [SAFE, 1n]), ethers.parseEther('10'), ATTACKER), SAFE);
  assert.equal(review.level, 'danger');
});

// Bypass: ERC-20 and ERC-721 share approve(address,uint256). On an NFT contract the
// second argument is a token ID, so approve(attacker, 0) grants token #0.
test('approve(other, 0) is not reported as a safe revocation', () => {
  assert.notEqual(reviewCall(call(iface.encodeFunctionData('approve', [ATTACKER, 0n])), SAFE).level, 'ok');
  // Approving the zero address is the real ERC-721 revocation and is safe.
  assert.equal(reviewCall(call(iface.encodeFunctionData('approve', [ethers.ZeroAddress, 7n])), SAFE).level, 'ok');
});
