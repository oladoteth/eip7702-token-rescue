/**
 * Lido (Ethereum): stETH and withdrawal request NFTs.
 * Addresses verified against mainnet on 2026-10-16.
 */

import { ethers } from 'ethers';
import { erc20Key, nftKey } from '../utils/batchKeys.js';

const CHAINS = {
  1: {
    steth: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
    withdrawalQueue: '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1'
  }
};

const stethInterface = new ethers.Interface([
  'function sharesOf(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transferShares(address to, uint256 sharesAmount) returns (uint256)'
]);
const queueInterface = new ethers.Interface([
  'function getWithdrawalRequests(address owner) view returns (uint256[])',
  'function getWithdrawalStatus(uint256[] requestIds) view returns ((uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])',
  'function getLastCheckpointIndex() view returns (uint256)',
  'function findCheckpointHints(uint256[] requestIds, uint256 firstIndex, uint256 lastIndex) view returns (uint256[])',
  'function claimWithdrawalsTo(uint256[] requestIds, uint256[] hints, address recipient)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)'
]);

async function read(provider, to, iface, name, args = []) {
  return iface.decodeFunctionResult(name, await provider.call({ to, data: iface.encodeFunctionData(name, args) }));
}

export const lido = {
  id: 'lido',
  name: 'Lido',
  supports: (chainId) => Boolean(CHAINS[chainId]),

  async detect({ chainId, provider, address }) {
    const { steth, withdrawalQueue } = CHAINS[chainId];
    const positions = [];

    const [[shares], [balance]] = await Promise.all([
      read(provider, steth, stethInterface, 'sharesOf', [address]),
      read(provider, steth, stethInterface, 'balanceOf', [address])
    ]);
    if (shares > 0n) {
      positions.push({
        id: `lido:steth`,
        adapter: 'lido',
        title: 'Lido stETH',
        details: [`${ethers.formatEther(balance)} stETH`],
        covers: [erc20Key(steth)],
        actions: [{
          id: 'transfer-shares',
          label: 'Move stETH to safe wallet',
          description: 'Moves the exact stETH shares, so rebasing and rounding cannot leave dust or fail the transfer.'
        }],
        data: { steth, shares }
      });
    }

    const [ids] = await read(provider, withdrawalQueue, queueInterface, 'getWithdrawalRequests', [address]);
    if (ids.length > 0) {
      const sorted = [...ids].sort((a, b) => (a < b ? -1 : 1));
      const [statuses] = await read(provider, withdrawalQueue, queueInterface, 'getWithdrawalStatus', [sorted]);
      const claimable = [];
      const pending = [];
      sorted.forEach((id, i) => {
        const status = statuses[i];
        if (status.isClaimed) return;
        (status.isFinalized ? claimable : pending).push({ id, amount: status.amountOfStETH });
      });

      if (claimable.length > 0) {
        const [lastIndex] = await read(provider, withdrawalQueue, queueInterface, 'getLastCheckpointIndex');
        const [hints] = await read(provider, withdrawalQueue, queueInterface, 'findCheckpointHints', [claimable.map((c) => c.id), 1n, lastIndex]);
        const total = claimable.reduce((sum, c) => sum + c.amount, 0n);
        positions.push({
          id: 'lido:claimable',
          adapter: 'lido',
          title: `Lido withdrawals ready to claim (${claimable.length})`,
          details: [`About ${ethers.formatEther(total)} ETH`, `Requests ${claimable.map((c) => `#${c.id}`).join(', ')}`],
          covers: claimable.map((c) => nftKey(withdrawalQueue, c.id)),
          actions: [{
            id: 'claim',
            label: 'Claim ETH to safe wallet',
            description: 'Claims the finalized withdrawals and sends the ETH straight to the safe wallet.'
          }],
          data: { withdrawalQueue, ids: claimable.map((c) => c.id), hints: [...hints] }
        });
      }
      if (pending.length > 0) {
        positions.push({
          id: 'lido:pending',
          adapter: 'lido',
          title: `Lido withdrawals still pending (${pending.length})`,
          details: [`About ${ethers.formatEther(pending.reduce((sum, p) => sum + p.amount, 0n))} ETH once finalized`],
          covers: pending.map((p) => nftKey(withdrawalQueue, p.id)),
          actions: [{
            id: 'transfer-nfts',
            label: 'Move withdrawal NFTs to safe wallet',
            description: 'Not claimable yet. The safe wallet can claim them once Lido finalizes them.'
          }],
          data: { withdrawalQueue, ids: pending.map((p) => p.id) }
        });
      }
    }
    return positions;
  },

  buildCalls(position, actionId, { from, to }) {
    const { data } = position;
    if (actionId === 'transfer-shares') {
      return [{
        target: data.steth,
        value: 0n,
        data: stethInterface.encodeFunctionData('transferShares', [to, data.shares]),
        contractName: 'Lido stETH',
        functionName: 'transferShares',
        args: [to, `${data.shares} shares`],
        source: 'position',
        covers: position.covers
      }];
    }
    if (actionId === 'claim') {
      return [{
        target: data.withdrawalQueue,
        value: 0n,
        data: queueInterface.encodeFunctionData('claimWithdrawalsTo', [data.ids, data.hints, to]),
        contractName: 'Lido Withdrawal Queue',
        functionName: 'claimWithdrawalsTo',
        args: [data.ids.map((id) => `#${id}`).join(', '), to],
        source: 'position',
        covers: position.covers
      }];
    }
    if (actionId === 'transfer-nfts') {
      return data.ids.map((id) => ({
        target: data.withdrawalQueue,
        value: 0n,
        data: queueInterface.encodeFunctionData('safeTransferFrom', [from, to, id]),
        contractName: 'Lido Withdrawal NFT',
        functionName: 'safeTransferFrom',
        args: [to, `#${id}`],
        source: 'position',
        covers: [nftKey(data.withdrawalQueue, id)]
      }));
    }
    throw new Error(`Unknown Lido action ${actionId}`);
  }
};
