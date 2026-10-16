/**
 * Uniswap v3 liquidity positions (NonfungiblePositionManager NFTs).
 * Addresses verified on each chain on 2026-10-16 (name() returns "Uniswap V3 Positions NFT-V1").
 *
 * The position NFT is moved as a whole: liquidity and uncollected fees go with it, and no
 * swap or price is involved. Closing the position inside the rescue would need price limits
 * to avoid sandwich losses, so it is left for the safe wallet to do afterwards.
 */

import { ethers } from 'ethers';
import { readMany, nftKey } from '../discovery/balances.js';

const MANAGERS = {
  1: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  42161: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  10: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  137: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  8453: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  56: '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613',
  42220: '0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A',
  130: '0x943e6e07a7E8E791dAFC44083e54041D743C46E9',
  480: '0xec12a9F9a09f50550686363766Cc153D03c27b5e',
  57073: '0xC0836E5B058BBE22ae2266e1AC488A1A0fD8DCE8',
  59144: '0x4615C383F85D0a2BbED973d83ccecf5CB7121463',
  11155111: '0x1238536071E1c677A632429e3655c799b22cDA52',
  84532: '0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2'
};

// Wallets with more positions than this are rare; the rest stay visible as NFTs in the scanner.
const MAX_POSITIONS = 50;

const managerInterface = new ethers.Interface([
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)'
]);
const symbolInterface = new ethers.Interface(['function symbol() view returns (string)']);

function decodeOr(iface, name, result, fallback) {
  if (!result.success) return fallback;
  try {
    return iface.decodeFunctionResult(name, result.returnData);
  } catch {
    return fallback;
  }
}

export const uniswapV3 = {
  id: 'uniswap-v3',
  name: 'Uniswap v3',
  supports: (chainId) => Boolean(MANAGERS[chainId]),

  async detect({ chainId, provider, address }) {
    const manager = MANAGERS[chainId];
    const [count] = managerInterface.decodeFunctionResult(
      'balanceOf',
      await provider.call({ to: manager, data: managerInterface.encodeFunctionData('balanceOf', [address]) })
    );
    const n = Number(count > BigInt(MAX_POSITIONS) ? MAX_POSITIONS : count);
    if (n === 0) return [];

    const idResults = await readMany(provider, Array.from({ length: n }, (_, i) => ({
      target: manager,
      data: managerInterface.encodeFunctionData('tokenOfOwnerByIndex', [address, i])
    })));
    const ids = idResults.map((r) => decodeOr(managerInterface, 'tokenOfOwnerByIndex', r, null)?.[0]).filter((id) => id != null);

    const positionResults = await readMany(provider, ids.map((id) => ({
      target: manager,
      data: managerInterface.encodeFunctionData('positions', [id])
    })));
    const details = ids.map((id, i) => ({ id, p: decodeOr(managerInterface, 'positions', positionResults[i], null) }))
      .filter((x) => x.p);

    const tokens = [...new Set(details.flatMap(({ p }) => [p.token0, p.token1]))];
    const symbolResults = await readMany(provider, tokens.map((token) => ({ target: token, data: symbolInterface.encodeFunctionData('symbol') })));
    const symbols = new Map(tokens.map((t, i) => [t, decodeOr(symbolInterface, 'symbol', symbolResults[i], ['?'])[0]]));

    return details.map(({ id, p }) => ({
      id: `uniswap-v3:${id}`,
      adapter: 'uniswap-v3',
      title: `Uniswap v3: ${symbols.get(p.token0)}/${symbols.get(p.token1)} ${Number(p.fee) / 10000}% (#${id})`,
      details: [
        p.liquidity > 0n ? 'Has liquidity' : 'No liquidity left',
        p.tokensOwed0 > 0n || p.tokensOwed1 > 0n ? 'Has uncollected tokens' : 'No uncollected tokens recorded'
      ],
      covers: [nftKey(manager, id)],
      actions: [{
        id: 'transfer-nft',
        label: 'Move position NFT to safe wallet',
        description: 'Liquidity and fees move with the NFT. No swap or price is involved. Close the position from the safe wallet afterwards.'
      }],
      data: { manager, tokenId: id }
    }));
  },

  buildCalls(position, actionId, { from, to }) {
    if (actionId !== 'transfer-nft') throw new Error(`Unknown Uniswap v3 action ${actionId}`);
    const { manager, tokenId } = position.data;
    return [{
      target: manager,
      value: 0n,
      data: managerInterface.encodeFunctionData('safeTransferFrom', [from, to, tokenId]),
      contractName: 'Uniswap v3 Positions',
      functionName: 'safeTransferFrom',
      args: [to, `#${tokenId}`],
      source: 'position',
      covers: position.covers
    }];
  }
};
