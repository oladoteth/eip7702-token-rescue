// End-to-end rescue check against a local anvil node (Prague hardfork).
// Uses the same rescueTx.js module as the app.
//
//   forge build && node scripts/e2e-rescue.mjs
//
// Exits non-zero if any assertion fails.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
  ensureDelegateDeployed,
  predictDelegateAddress,
  buildRescueTx,
  estimateRescueGas,
  buildErc20SweepCall,
  isDelegatedTo,
  nftTransferCalls,
  encodeExecute,
  describeRescueError
} from '../src/utils/rescueTx.js';

const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
// anvil's first default account
const FUNDER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function artifact(name) {
  const json = JSON.parse(readFileSync(`out/RescueDelegate.t.sol/${name}.json`, 'utf8'));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

async function waitForRpc(provider) {
  for (let i = 0; i < 50; i++) {
    try {
      return await provider.getBlockNumber();
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('anvil did not start');
}

const anvil = spawn('anvil', ['--hardfork', 'prague', '--port', String(PORT), '--silent']);
let failed = false;

try {
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { pollingInterval: 100, cacheTimeout: -1 });
  await waitForRpc(provider);

  const funder = new ethers.NonceManager(new ethers.Wallet(FUNDER_KEY, provider));
  const compromised = ethers.Wallet.createRandom().connect(provider);
  const payer = ethers.Wallet.createRandom().connect(provider);
  const safe = ethers.Wallet.createRandom().address;

  // Set up the compromised wallet: tokens, an NFT, some ETH. The payer gets gas money.
  const { abi: erc20Abi, bytecode: erc20Code } = artifact('MockERC20');
  const { abi: nftAbi, bytecode: nftCode } = artifact('MockERC721');
  const { abi: multiAbi, bytecode: multiCode } = artifact('MockERC1155');
  const token = await new ethers.ContractFactory(erc20Abi, erc20Code, funder).deploy();
  const nft = await new ethers.ContractFactory(nftAbi, nftCode, funder).deploy();
  const multi = await new ethers.ContractFactory(multiAbi, multiCode, funder).deploy();
  await (await token.mint(compromised.address, ethers.parseEther('1000'))).wait();
  await (await nft.mint(compromised.address, 7)).wait();
  await (await multi.mint(compromised.address, 1, 50)).wait();
  await (await multi.mint(compromised.address, 2, 3)).wait();
  await (await funder.sendTransaction({ to: compromised.address, value: ethers.parseEther('0.5') })).wait();
  await (await funder.sendTransaction({ to: payer.address, value: ethers.parseEther('1') })).wait();

  // 1. Delegate deploys to the predicted address, and a second call is a no-op.
  const deployed = await ensureDelegateDeployed(payer);
  assert.equal(deployed.address, predictDelegateAddress(payer.address));
  assert.ok(deployed.txHash, 'first call deploys');
  const again = await ensureDelegateDeployed(payer);
  assert.equal(again.txHash, null, 'second call reuses the existing delegate');
  console.log('ok  delegate deployed at', deployed.address);

  // 2. Build the batch the way the app does: full ERC-20 balance, the ERC-721, both
  //    ERC-1155 items in one batch call, then all native ETH.
  const tokenAddress = await token.getAddress();
  const nftAddress = await nft.getAddress();
  const multiAddress = await multi.getAddress();
  const calls = [
    await buildErc20SweepCall(provider, tokenAddress, compromised.address, safe),
    ...nftTransferCalls([
      { type: 'ERC-721', token: nftAddress, tokenId: 7n, amount: 1n },
      { type: 'ERC-1155', token: multiAddress, tokenId: 1n, amount: 50n },
      { type: 'ERC-1155', token: multiAddress, tokenId: 2n, amount: 3n }
    ], compromised.address, safe),
    { target: safe, value: await provider.getBalance(compromised.address), data: '0x' }
  ];
  assert.equal(calls.length, 4, 'ERC-1155 items share one call');

  // 3. One type-4 tx from the payer.
  const payerBefore = await provider.getBalance(payer.address);
  const tx = await buildRescueTx({ compromised, delegateAddress: deployed.address, calls });
  const { estimate, gasLimit } = await estimateRescueGas(provider, tx, payer.address);
  assert.ok(estimate > 100_000n, `estimate includes the delegated execution (got ${estimate})`);
  const receipt = await (await payer.sendTransaction({ ...tx, gasLimit })).wait();
  assert.equal(receipt.status, 1);
  console.log('ok  rescue tx mined', receipt.hash, 'gas used', receipt.gasUsed.toString(), 'estimate', estimate.toString());

  // 4. Everything moved, the compromised account paid nothing, the payer paid the gas.
  assert.equal(await token.balanceOf(safe), ethers.parseEther('1000'));
  assert.equal(await token.balanceOf(compromised.address), 0n);
  assert.equal(await nft.ownerOf(7), safe);
  assert.equal(await multi.balanceOf(safe, 1), 50n);
  assert.equal(await multi.balanceOf(safe, 2), 3n);
  assert.equal(await multi.balanceOf(compromised.address, 1), 0n);
  assert.equal(await provider.getBalance(safe), ethers.parseEther('0.5'));
  assert.equal(await provider.getBalance(compromised.address), 0n);
  assert.ok((await provider.getBalance(payer.address)) < payerBefore, 'payer paid gas');
  assert.ok(await isDelegatedTo(provider, compromised.address, deployed.address));
  console.log('ok  assets at safe address, compromised balance 0');

  // 5. The attacker holds the compromised key. They must not be able to use our delegate.
  await (await funder.sendTransaction({ to: compromised.address, value: ethers.parseEther('0.1') })).wait();
  await assert.rejects(
    compromised.sendTransaction({ to: compromised.address, data: encodeExecute([{ target: safe, value: 1n }]) }),
    (error) => describeRescueError(error).includes('not the controller')
  );
  console.log('ok  compromised key cannot execute through the delegate');

  // 6. A failing call is reported by position before anything is sent.
  const badTx = await buildRescueTx({
    compromised,
    delegateAddress: deployed.address,
    calls: [{ target: tokenAddress, value: 0n, data: token.interface.encodeFunctionData('transfer', [safe, 1n]) }]
  });
  await assert.rejects(estimateRescueGas(provider, badTx, payer.address), /Call #1 in the batch reverted: balance/);
  console.log('ok  failing batch is caught at estimation with a readable reason');

  console.log('\nE2E PASSED');
} catch (error) {
  failed = true;
  console.error('\nE2E FAILED:', error);
} finally {
  anvil.kill();
}
process.exit(failed ? 1 : 0);
