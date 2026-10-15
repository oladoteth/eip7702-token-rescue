// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseABI } from '../src/utils/contracts.js';
import { parseABI as parseABIFromFunctions } from '../src/utils/contractFunctions.js';

// The page holds private keys. A pasted "ABI" from a scammer must never run.
test('pasted text is never executed', () => {
  globalThis.__pwned = false;
  const payloads = [
    '[(() => { globalThis.__pwned = true; return []; })()]',
    '(globalThis.__pwned = true, [])',
    'function x() { globalThis.__pwned = true }'
  ];
  for (const payload of payloads) {
    assert.throws(() => parseABI(payload));
  }
  assert.equal(globalThis.__pwned, false);
});

test('both modules use the same safe parser', () => {
  assert.equal(parseABIFromFunctions, parseABI);
});

test('JSON ABI arrays and compiler artifacts parse', () => {
  const abi = [{ type: 'function', name: 'stake', inputs: [{ type: 'uint256', name: 'a' }], outputs: [], stateMutability: 'nonpayable' }];
  assert.deepEqual(parseABI(JSON.stringify(abi)), abi);
  assert.deepEqual(parseABI(JSON.stringify({ abi })), abi);
});

test('human-readable signatures parse to JSON ABI', () => {
  const abi = parseABI(`
    function withdraw(uint256 amount)
    function balanceOf(address owner) view returns (uint256)
  `);
  assert.deepEqual(abi.map((f) => f.name), ['withdraw', 'balanceOf']);
  assert.equal(abi[1].stateMutability, 'view');
});
