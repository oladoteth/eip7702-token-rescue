// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { parseWeiValue, decodeTransactionWithContracts } from '../src/utils/transactionDecoder.js';
import { buildCustomCall, functionSignature, parseABI } from '../src/utils/contractFunctions.js';

const VAULT = ethers.Wallet.createRandom().address;
const OTHER = ethers.Wallet.createRandom().address;
const SAFE = ethers.Wallet.createRandom().address;
const abi = parseABI(`
  function withdraw(uint256 amount, address to)
  function deposit() payable
  function safeTransferFrom(address from, address to, uint256 id)
  function safeTransferFrom(address from, address to, uint256 id, bytes data)
  function claim(uint256[] ids, (address token, uint256 amount) extra)
  function setFlag(bool on)
`);
const vault = { address: VAULT, abi, name: 'Vault' };
const iface = new ethers.Interface(abi);

// Value units decide how much money moves. Wallet and explorer JSON gives wei.
test('values are read as wei, hex or decimal; anything else is refused, never zeroed', () => {
  assert.equal(parseWeiValue('0x2386f26fc10000'), 10_000_000_000_000_000n);
  assert.equal(parseWeiValue('10000000000000000'), 10_000_000_000_000_000n);
  assert.equal(parseWeiValue(5), 5n);
  assert.equal(parseWeiValue(undefined), 0n);
  assert.equal(parseWeiValue('0x0'), 0n);
  for (const bad of ['0.01', '1e18', 'abc', '-5', 1.5, -1]) {
    assert.throws(() => parseWeiValue(bad), undefined, String(bad));
  }
});

test('JSON transaction decodes with its "to", data and hex value', () => {
  const data = iface.encodeFunctionData('deposit', []);
  const call = decodeTransactionWithContracts(JSON.stringify({ to: VAULT, data, value: '0x2386f26fc10000' }), [vault]);
  assert.equal(call.target, VAULT);
  assert.equal(call.functionName, 'deposit');
  assert.equal(call.value, 10_000_000_000_000_000n);
});

test('bare hex calldata uses the contract the user chose, and needs one', () => {
  const data = iface.encodeFunctionData('withdraw', [5n, SAFE]);
  assert.throws(() => decodeTransactionWithContracts(data, [vault]), /Choose which loaded contract/);
  const call = decodeTransactionWithContracts(data, [vault], VAULT);
  assert.deepEqual(call.args, ['5', SAFE]);
});

// Calldata meant for another contract, or with bytes appended, must not be added silently.
test('calldata that does not match the ABI, or has trailing bytes, is refused', () => {
  const foreign = new ethers.Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [OTHER, 1n]);
  assert.throws(() => decodeTransactionWithContracts(foreign, [vault], VAULT), /does not match any function/);
  const padded = iface.encodeFunctionData('withdraw', [5n, SAFE]) + 'deadbeef';
  assert.throws(() => decodeTransactionWithContracts(padded, [vault], VAULT), /extra or malformed bytes/);
  assert.throws(() => decodeTransactionWithContracts(JSON.stringify({ to: OTHER, data: padded }), [vault]), /No loaded contract/);
});

test('value sent to a non-payable function is refused', () => {
  const data = iface.encodeFunctionData('withdraw', [5n, SAFE]);
  assert.throws(() => decodeTransactionWithContracts(JSON.stringify({ to: VAULT, data, value: '0x1' }), [vault]), /not payable/);
});

// Overloads share a name. Selecting by name picked whichever came first.
test('overloaded functions are built by exact signature', () => {
  const sigs = abi.filter((f) => f.name === 'safeTransferFrom').map(functionSignature);
  assert.deepEqual(sigs, ['safeTransferFrom(address,address,uint256)', 'safeTransferFrom(address,address,uint256,bytes)']);
  const withData = buildCustomCall(vault, sigs[1], [OTHER, SAFE, '7', '0x1234']);
  assert.equal(withData.data.slice(0, 10), iface.getFunction(sigs[1]).selector);
  const without = buildCustomCall(vault, sigs[0], [OTHER, SAFE, '7']);
  assert.equal(without.data.slice(0, 10), iface.getFunction(sigs[0]).selector);
});

test('arrays and tuples take JSON; bools must be true or false', () => {
  const call = buildCustomCall(vault, 'claim(uint256[],(address,uint256))', ['[1, 2, 3]', JSON.stringify([OTHER, '100'])]);
  const [ids, extra] = iface.decodeFunctionData('claim', call.data);
  assert.deepEqual([...ids], [1n, 2n, 3n]);
  assert.equal(extra.amount, 100n);
  assert.throws(() => buildCustomCall(vault, 'claim(uint256[],(address,uint256))', ['1,2', '[]']), /must be JSON/);
  assert.throws(() => buildCustomCall(vault, 'setFlag(bool)', ['yes']), /true or false/);
  assert.equal(iface.decodeFunctionData('setFlag', buildCustomCall(vault, 'setFlag(bool)', ['false']).data)[0], false);
});

test('missing or invalid parameters and value on non-payable functions are refused', () => {
  assert.throws(() => buildCustomCall(vault, 'withdraw(uint256,address)', ['5']), /"to" is required/);
  assert.throws(() => buildCustomCall(vault, 'withdraw(uint256,address)', ['5', 'not-an-address']), /Invalid parameter/);
  assert.throws(() => buildCustomCall(vault, 'withdraw(uint256,address)', ['5', SAFE], '0.1'), /not payable/);
  assert.equal(buildCustomCall(vault, 'deposit()', [], '0.5').value, ethers.parseEther('0.5'));
});
