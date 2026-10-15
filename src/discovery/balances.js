/**
 * On-chain ERC-20 balances. This is the source of truth for what can be rescued.
 */

import { ethers } from 'ethers';

// Multicall3, deployed at the same address on most EVM chains.
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const CALLS_PER_MULTICALL = 200;
const PARALLEL_SINGLE_CALLS = 8;

const erc20 = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
const multicall = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)'
]);

function decodeBalance(success, returnData) {
  if (!success || returnData === '0x') return null;
  try {
    return erc20.decodeFunctionResult('balanceOf', returnData)[0];
  } catch {
    return null;
  }
}

/**
 * Reads balanceOf(owner) for each token.
 * @param {ethers.Provider} provider
 * @param {string[]} tokens
 * @param {string} owner
 * @returns {Promise<Map<string, bigint|null>>} Lower-case token address to balance.
 *   null means the call failed (not a token, or reverted).
 */
export async function readErc20Balances(provider, tokens, owner) {
  const balances = new Map();
  const callData = erc20.encodeFunctionData('balanceOf', [owner]);

  if ((await provider.getCode(MULTICALL3)) !== '0x') {
    for (let i = 0; i < tokens.length; i += CALLS_PER_MULTICALL) {
      const chunk = tokens.slice(i, i + CALLS_PER_MULTICALL);
      const data = multicall.encodeFunctionData('aggregate3', [chunk.map((target) => [target, true, callData])]);
      const raw = await provider.call({ to: MULTICALL3, data });
      const [results] = multicall.decodeFunctionResult('aggregate3', raw);
      chunk.forEach((token, j) => balances.set(token.toLowerCase(), decodeBalance(results[j].success, results[j].returnData)));
    }
    return balances;
  }

  for (let i = 0; i < tokens.length; i += PARALLEL_SINGLE_CALLS) {
    await Promise.all(
      tokens.slice(i, i + PARALLEL_SINGLE_CALLS).map(async (token) => {
        try {
          balances.set(token.toLowerCase(), decodeBalance(true, await provider.call({ to: token, data: callData })));
        } catch {
          balances.set(token.toLowerCase(), null);
        }
      })
    );
  }
  return balances;
}
