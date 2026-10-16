/**
 * On-chain balance and ownership reads. This is the source of truth for what can be rescued.
 */

import { ethers } from 'ethers';

// Multicall3, deployed at the same address on most EVM chains.
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const CALLS_PER_MULTICALL = 200;
const PARALLEL_SINGLE_CALLS = 8;

const tokenInterface = new ethers.Interface([
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function balanceOf(address, uint256) view returns (uint256)'
]);
const multicall = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)'
]);

/**
 * Runs read-only calls through Multicall3 when it is deployed, one by one otherwise.
 * A failing call never fails the batch.
 * @param {ethers.Provider} provider
 * @param {Array<{target: string, data: string}>} calls
 * @returns {Promise<Array<{success: boolean, returnData: string}>>} Same order as `calls`
 */
async function readMany(provider, calls) {
  const results = [];
  if ((await provider.getCode(MULTICALL3)) !== '0x') {
    for (let i = 0; i < calls.length; i += CALLS_PER_MULTICALL) {
      const chunk = calls.slice(i, i + CALLS_PER_MULTICALL);
      const data = multicall.encodeFunctionData('aggregate3', [chunk.map((c) => [c.target, true, c.data])]);
      const [decoded] = multicall.decodeFunctionResult('aggregate3', await provider.call({ to: MULTICALL3, data }));
      results.push(...decoded.map((r) => ({ success: r.success, returnData: r.returnData })));
    }
    return results;
  }

  for (let i = 0; i < calls.length; i += PARALLEL_SINGLE_CALLS) {
    const chunk = await Promise.all(
      calls.slice(i, i + PARALLEL_SINGLE_CALLS).map(async (c) => {
        try {
          return { success: true, returnData: await provider.call({ to: c.target, data: c.data }) };
        } catch {
          return { success: false, returnData: '0x' };
        }
      })
    );
    results.push(...chunk);
  }
  return results;
}

function decode(fragment, { success, returnData }) {
  if (!success || returnData === '0x') return null;
  try {
    return tokenInterface.decodeFunctionResult(fragment, returnData)[0];
  } catch {
    return null;
  }
}

/**
 * Reads balanceOf(owner) for each ERC-20 token.
 * @param {ethers.Provider} provider
 * @param {string[]} tokens
 * @param {string} owner
 * @returns {Promise<Map<string, bigint|null>>} Lower-case token address to balance.
 *   null means the call failed (not a token, or reverted).
 */
export async function readErc20Balances(provider, tokens, owner) {
  const data = tokenInterface.encodeFunctionData('balanceOf(address)', [owner]);
  const results = await readMany(provider, tokens.map((target) => ({ target, data })));
  return new Map(tokens.map((token, i) => [token.toLowerCase(), decode('balanceOf(address)', results[i])]));
}

/**
 * Key for one NFT in maps and selections.
 * @returns {string}
 */
export function nftKey(token, tokenId) {
  return `${token.toLowerCase()}:${BigInt(tokenId)}`;
}

/**
 * Reads how many of each NFT `owner` holds: ownerOf for ERC-721, balanceOf for ERC-1155.
 * @param {ethers.Provider} provider
 * @param {Array<{type: string, token: string, tokenId: bigint}>} items
 * @param {string} owner
 * @returns {Promise<Map<string, bigint|null>>} nftKey to amount held (0n when not owned).
 *   null means the call failed.
 */
export async function readNftHoldings(provider, items, owner) {
  const calls = items.map((item) => ({
    target: item.token,
    data: item.type === 'ERC-1155'
      ? tokenInterface.encodeFunctionData('balanceOf(address,uint256)', [owner, item.tokenId])
      : tokenInterface.encodeFunctionData('ownerOf', [item.tokenId])
  }));
  const results = await readMany(provider, calls);

  return new Map(items.map((item, i) => {
    if (item.type === 'ERC-1155') {
      return [nftKey(item.token, item.tokenId), decode('balanceOf(address,uint256)', results[i])];
    }
    const holder = decode('ownerOf', results[i]);
    return [nftKey(item.token, item.tokenId), holder == null ? null : (holder.toLowerCase() === owner.toLowerCase() ? 1n : 0n)];
  }));
}
