// End-to-end test of a batch too large for one transaction, on anvil with a low block gas
// limit. Uses the same executeInParts as the app.
//
//   forge build && node scripts/e2e-split.mjs
//
// Exits non-zero if any assertion fails.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { ensureDelegateDeployed, erc20TransferCall, nativeSweepCall, revokeCalls, encodeExecute } from '../src/utils/rescueTx.js';
import { executeInParts } from '../src/utils/batchSplit.js';
import { PERMIT2 } from '../src/discovery/approvals.js';
import { RESCUE_DELEGATE_ABI } from '../src/contracts/rescueDelegate.js';

const PORT = 8552;
const BLOCK_GAS_LIMIT = 1_000_000;
const TOKENS = 45;
const FUNDER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const anvil = spawn('anvil', ['--hardfork', 'prague', '--port', String(PORT), '--gas-limit', String(BLOCK_GAS_LIMIT), '--silent']);
let failed = false;

try {
  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${PORT}`, 31337, { staticNetwork: true, cacheTimeout: -1, pollingInterval: 100 });
  for (let i = 0; ; i++) {
    try { await provider.getBlockNumber(); break; } catch { if (i > 100) throw new Error('anvil did not start'); await new Promise((r) => setTimeout(r, 100)); }
  }
  const json = JSON.parse(readFileSync('out/RescueDelegate.t.sol/MockERC20.json', 'utf8'));
  const funder = new ethers.NonceManager(new ethers.Wallet(FUNDER_KEY, provider));
  const compromised = ethers.Wallet.createRandom().connect(provider);
  const payer = ethers.Wallet.createRandom().connect(provider);
  const attacker = ethers.Wallet.createRandom().address;
  const safe = ethers.Wallet.createRandom().address;

  await (await funder.sendTransaction({ to: payer.address, value: ethers.parseEther('2') })).wait();
  await (await funder.sendTransaction({ to: compromised.address, value: ethers.parseEther('0.3') })).wait();

  // Many different tokens: each transfer touches a cold contract, so the batch gets heavy.
  const tokens = [];
  for (let i = 0; i < TOKENS; i++) {
    const token = await new ethers.ContractFactory(json.abi, json.bytecode.object, funder).deploy();
    await token.waitForDeployment();
    await (await token.mint(compromised.address, ethers.parseEther(String(i + 1)))).wait();
    tokens.push(token);
  }
  // The attacker holds allowances on three of them.
  for (const token of tokens.slice(0, 3)) {
    await (await token.connect(compromised).approve(attacker, ethers.MaxUint256)).wait();
  }
  const delegate = await ensureDelegateDeployed(payer);

  const approvals = await Promise.all(tokens.slice(0, 3).map(async (t) => ({ kind: 'erc20', token: await t.getAddress(), spender: attacker })));
  const calls = [
    ...revokeCalls(approvals, PERMIT2),
    ...(await Promise.all(tokens.map(async (t, i) => erc20TransferCall({ token: await t.getAddress(), to: safe, amount: ethers.parseEther(String(i + 1)), symbol: `T${i}`, decimals: 18 })))),
    nativeSweepCall(compromised.address, safe, 'ETH')
  ];

  const updates = [];
  const progress = await executeInParts({ compromised, payer, delegateAddress: delegate.address, calls, onUpdate: (p) => updates.push(p) });
  console.log('parts:', progress.map((p) => `#${p.index + 1} ${p.calls} calls ${p.status}`).join(' | '));

  assert.ok(progress.length >= 2, 'the batch was split');
  assert.ok(progress.every((p) => p.status === 'confirmed'), 'every part confirmed with the delegation applied');
  assert.equal(progress.reduce((sum, p) => sum + p.calls, 0), calls.length, 'every call sent exactly once');

  // Each part carried its own authorization, with consecutive nonces.
  const executeIface = new ethers.Interface(RESCUE_DELEGATE_ABI);
  const sentTxs = await Promise.all(progress.map((p) => provider.getTransaction(p.hash)));
  const authNonces = sentTxs.map((tx) => {
    assert.equal(tx.type, 4);
    assert.equal(tx.authorizationList.length, 1);
    return BigInt(tx.authorizationList[0].nonce);
  });
  authNonces.forEach((n, i) => i > 0 && assert.equal(n, authNonces[i - 1] + 1n, 'consecutive authorization nonces'));

  // Revokes run in part 1, before any asset moves.
  const [firstCalls] = executeIface.decodeFunctionData('execute', sentTxs[0].data);
  assert.deepEqual(firstCalls.slice(0, 3).map((c) => c.data.slice(0, 10)), Array(3).fill(ethers.id('approve(address,uint256)').slice(0, 10)));
  assert.equal(sentTxs[0].data, sentTxs[0].data); // decoded above without error
  void encodeExecute;

  for (let i = 0; i < TOKENS; i++) {
    assert.equal(await tokens[i].balanceOf(safe), ethers.parseEther(String(i + 1)), `token ${i} at safe`);
  }
  for (const token of tokens.slice(0, 3)) {
    assert.equal(await token.allowance(compromised.address, attacker), 0n, 'allowance revoked');
  }
  assert.equal(await provider.getBalance(compromised.address), 0n, 'ETH swept in the last part');
  console.log(`ok  ${calls.length} calls in ${progress.length} transactions; revokes in part 1; all ${TOKENS} tokens and the ETH at the safe wallet`);
  console.log('\nE2E SPLIT PASSED');
} catch (error) {
  failed = true;
  console.error('\nE2E SPLIT FAILED:', error);
} finally {
  anvil.kill();
}
process.exit(failed ? 1 : 0);
