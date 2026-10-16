// Protocol adapter test against real Lido, Aave v3 and Uniswap v3 contracts on a mainnet
// fork. Needs network access, so it is not part of `npm test`.
//
//   node scripts/fork-positions.mjs [mainnet RPC URL]
//
// Exits non-zero if any assertion fails.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { ensureDelegateDeployed, buildRescueTx, estimateRescueGas, nativeSweepCall, isDelegatedTo } from '../src/utils/rescueTx.js';
import { scanPositions, buildPositionCalls } from '../src/positions/index.js';
import { reviewCall } from '../src/utils/callReview.js';

const FORK_URL = process.argv[2] ?? 'https://ethereum.publicnode.com';
const PORT = 8549;
const NETWORK = { chainId: 31337, positionsChainId: 1 };

const STETH = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
const QUEUE = '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const AAVE_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const UNI_NPM = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';

const steth = new ethers.Interface([
  'function submit(address referral) payable returns (uint256)',
  'function sharesOf(address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)'
]);
const queue = new ethers.Interface([
  'function requestWithdrawals(uint256[] amounts, address owner) returns (uint256[])',
  'function getLastFinalizedRequestId() view returns (uint256)',
  'function getWithdrawalStatus(uint256[]) view returns ((uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])',
  'function transferFrom(address, address, uint256)',
  'function ownerOf(uint256) view returns (address)'
]);
const weth = new ethers.Interface(['function deposit() payable', 'function approve(address, uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const pool = new ethers.Interface(['function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)']);
const npm = new ethers.Interface([
  'function totalSupply() view returns (uint256)',
  'function tokenByIndex(uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function transferFrom(address, address, uint256)'
]);

const anvil = spawn('anvil', ['--fork-url', FORK_URL, '--chain-id', '31337', '--port', String(PORT), '--silent']);
let failed = false;

try {
  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${PORT}`, 31337, { staticNetwork: true, cacheTimeout: -1, pollingInterval: 100 });
  for (let i = 0; ; i++) {
    try { await provider.getBlockNumber(); break; } catch { if (i > 300) throw new Error('anvil did not start'); await new Promise((r) => setTimeout(r, 100)); }
  }
  const rpc = (method, params) => provider.send(method, params);
  const call = async (to, iface, name, args = []) => iface.decodeFunctionResult(name, await provider.call({ to, data: iface.encodeFunctionData(name, args) }));
  const sendAs = async (from, to, data, value = 0n) => {
    await rpc('anvil_impersonateAccount', [from]);
    const hash = await rpc('eth_sendTransaction', [{ from, to, data, value: ethers.toQuantity(value) }]);
    const receipt = await provider.waitForTransaction(hash);
    assert.equal(receipt.status, 1, `setup tx to ${to} failed`);
  };

  const compromised = ethers.Wallet.createRandom().connect(provider);
  const payer = ethers.Wallet.createRandom().connect(provider);
  const safe = ethers.Wallet.createRandom().address;
  await rpc('anvil_setBalance', [compromised.address, ethers.toQuantity(ethers.parseEther('5'))]);
  await rpc('anvil_setBalance', [payer.address, ethers.toQuantity(ethers.parseEther('1'))]);
  const c = compromised.address;

  // Lido: stake, then request a withdrawal (stays pending on a fork).
  await sendAs(c, STETH, steth.encodeFunctionData('submit', [ethers.ZeroAddress]), ethers.parseEther('2'));
  await sendAs(c, STETH, steth.encodeFunctionData('approve', [QUEUE, ethers.MaxUint256]));
  await sendAs(c, QUEUE, queue.encodeFunctionData('requestWithdrawals', [[ethers.parseEther('0.5')], c]));
  // Lido: a real finalized, unclaimed withdrawal NFT, handed over by its owner.
  const [lastFinalized] = await call(QUEUE, queue, 'getLastFinalizedRequestId');
  let finalizedId = null;
  for (let id = lastFinalized; id > lastFinalized - 500n && finalizedId == null; id--) {
    const [[status]] = await call(QUEUE, queue, 'getWithdrawalStatus', [[id]]);
    if (status.isFinalized && !status.isClaimed) finalizedId = id;
  }
  assert.ok(finalizedId, 'found a finalized unclaimed Lido request');
  const [[finalizedStatus]] = await call(QUEUE, queue, 'getWithdrawalStatus', [[finalizedId]]);
  await rpc('anvil_setBalance', [finalizedStatus.owner, ethers.toQuantity(ethers.parseEther('1'))]);
  await sendAs(finalizedStatus.owner, QUEUE, queue.encodeFunctionData('transferFrom', [finalizedStatus.owner, c, finalizedId]));

  // Aave v3: supply WETH.
  await sendAs(c, WETH, weth.encodeFunctionData('deposit'), ethers.parseEther('1'));
  await sendAs(c, WETH, weth.encodeFunctionData('approve', [AAVE_POOL, ethers.MaxUint256]));
  await sendAs(c, AAVE_POOL, pool.encodeFunctionData('supply', [WETH, ethers.parseEther('1'), c, 0]));

  // Uniswap v3: take over a recent LP NFT held by an EOA.
  const [supply] = await call(UNI_NPM, npm, 'totalSupply');
  let lpId = null;
  for (let i = supply - 1n; i > supply - 200n && lpId == null; i--) {
    const [id] = await call(UNI_NPM, npm, 'tokenByIndex', [i]);
    const [owner] = await call(UNI_NPM, npm, 'ownerOf', [id]);
    if ((await provider.getCode(owner)) === '0x') {
      await rpc('anvil_setBalance', [owner, ethers.toQuantity(ethers.parseEther('1'))]);
      await sendAs(owner, UNI_NPM, npm.encodeFunctionData('transferFrom', [owner, c, id]));
      lpId = id;
    }
  }
  assert.ok(lpId, 'took over a Uniswap v3 position');
  console.log(`ok  setup: Lido stake + pending request + finalized #${finalizedId}, Aave WETH supply, Uniswap #${lpId}`);

  // Adapters must find every position from chain state alone.
  const { positions, errors } = await scanPositions({ network: NETWORK, provider, address: c });
  assert.deepEqual(errors, []);
  const byId = Object.fromEntries(positions.map((p) => [p.id, p]));
  assert.ok(byId['lido:steth'], 'stETH found');
  assert.ok(byId['lido:claimable']?.data.ids.includes(finalizedId), 'finalized request found');
  assert.equal(byId['lido:pending']?.data.ids.length, 1, 'pending request found');
  const aavePosition = positions.find((p) => p.adapter === 'aave-v3' && p.data.asset.toLowerCase() === WETH.toLowerCase());
  assert.ok(aavePosition, 'Aave WETH supply found');
  assert.ok(byId[`uniswap-v3:${lpId}`], 'Uniswap position found');
  console.log(`ok  adapters found ${positions.length} positions:`, positions.map((p) => p.title).join(' | '));

  // One batch: the default action of every position, then the ETH sweep.
  const [sharesBefore] = await call(STETH, steth, 'sharesOf', [c]);
  const ethBefore = await provider.getBalance(c);
  const calls = [
    ...positions.flatMap((p) => buildPositionCalls(p, p.actions[0].id, { from: c, to: safe })),
    nativeSweepCall(c, safe, 'ETH')
  ];
  for (const callItem of calls) {
    assert.equal(reviewCall(callItem, safe).level, 'ok', `review: ${callItem.functionName}`);
  }

  const delegate = await ensureDelegateDeployed(payer);
  const tx = await buildRescueTx({ compromised, delegateAddress: delegate.address, calls });
  const { gasLimit, estimate } = await estimateRescueGas(provider, tx, payer.address);
  const receipt = await (await payer.sendTransaction({ ...tx, gasLimit })).wait();
  assert.equal(receipt.status, 1);
  assert.ok(await isDelegatedTo(provider, c, delegate.address));
  console.log(`ok  rescue mined, ${calls.length} calls, gas used ${receipt.gasUsed} (estimate ${estimate})`);

  // Every asset is at the safe wallet.
  const [sharesSafe] = await call(STETH, steth, 'sharesOf', [safe]);
  assert.equal(sharesSafe, sharesBefore, 'all stETH shares moved exactly');
  assert.equal((await call(STETH, steth, 'sharesOf', [c]))[0], 0n);
  for (const id of byId['lido:pending'].data.ids) {
    assert.equal((await call(QUEUE, queue, 'ownerOf', [id]))[0], safe, 'pending NFT moved');
  }
  const [[claimed]] = await call(QUEUE, queue, 'getWithdrawalStatus', [[finalizedId]]);
  assert.equal(claimed.isClaimed, true, 'finalized withdrawal claimed');
  const safeEth = await provider.getBalance(safe);
  assert.ok(safeEth > ethBefore, `claimed ETH reached the safe wallet (${ethers.formatEther(safeEth)} ETH)`);
  assert.equal(await provider.getBalance(c), 0n, 'no ETH left on the compromised account');
  assert.ok((await call(WETH, weth, 'balanceOf', [safe]))[0] >= ethers.parseEther('1'), 'Aave WETH withdrawn to safe');
  assert.equal((await call(aavePosition.data.aToken, weth, 'balanceOf', [c]))[0], 0n, 'no aWETH left');
  assert.equal((await call(UNI_NPM, npm, 'ownerOf', [lpId]))[0], safe, 'Uniswap position moved');
  console.log(`ok  safe holds the stETH shares, ${ethers.formatEther(safeEth)} ETH, the WETH, the pending Lido NFT and the LP NFT`);

  // Rescan: nothing left to release.
  const after = await scanPositions({ network: NETWORK, provider, address: c });
  assert.equal(after.positions.length, 0, 'no positions left');
  console.log('ok  rescan finds nothing left\n\nFORK POSITIONS PASSED');
} catch (error) {
  failed = true;
  console.error('\nFORK POSITIONS FAILED:', error);
} finally {
  anvil.kill();
}
process.exit(failed ? 1 : 0);
