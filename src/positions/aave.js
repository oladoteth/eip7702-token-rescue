/**
 * Aave v3: supplied collateral (aTokens). Pool addresses verified on each chain on
 * 2026-10-16 with getReservesList and getReserveData.
 */

import { ethers } from 'ethers';
import { readMany } from '../discovery/balances.js';
import { erc20Key } from '../utils/batchKeys.js';

const POOLS = {
  1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  42161: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  10: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  137: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  56: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
  100: '0xb50201558B00496A145fE76f7424749556E326D8',
  534352: '0x11fCfe756c05AD438e312a7fd934381537D3cFfe',
  59144: '0xc47b8C00b0f69a36fa203Ffeac0334874574a8Ac',
  146: '0x5362dBb1e601abF3a4c14c22ffEdA64042E5eAA3',
  42220: '0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402',
  11155111: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
  84532: '0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27'
};

const poolInterface = new ethers.Interface([
  'function getReservesList() view returns (address[])',
  'function getReserveData(address asset) view returns (((uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)'
]);
const tokenInterface = new ethers.Interface([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)'
]);

function decodeOr(iface, name, result, fallback) {
  if (!result.success) return fallback;
  try {
    return iface.decodeFunctionResult(name, result.returnData)[0];
  } catch {
    return fallback;
  }
}

export const aave = {
  id: 'aave-v3',
  name: 'Aave v3',
  supports: (chainId) => Boolean(POOLS[chainId]),

  async detect({ chainId, provider, address }) {
    const pool = POOLS[chainId];
    const [assets] = poolInterface.decodeFunctionResult(
      'getReservesList',
      await provider.call({ to: pool, data: poolInterface.encodeFunctionData('getReservesList') })
    );

    const reserveResults = await readMany(provider, assets.map((asset) => ({
      target: pool,
      data: poolInterface.encodeFunctionData('getReserveData', [asset])
    })));
    const reserves = assets.map((asset, i) => {
      const data = decodeOr(poolInterface, 'getReserveData', reserveResults[i], null);
      return data && { asset, aToken: data.aTokenAddress, variableDebt: data.variableDebtTokenAddress, stableDebt: data.stableDebtTokenAddress };
    }).filter(Boolean);

    const balanceOf = tokenInterface.encodeFunctionData('balanceOf', [address]);
    const balances = await readMany(provider, reserves.flatMap((r) => [
      { target: r.aToken, data: balanceOf },
      { target: r.variableDebt, data: balanceOf },
      { target: r.stableDebt, data: balanceOf }
    ]));
    let hasDebt = false;
    const supplied = [];
    reserves.forEach((reserve, i) => {
      const supply = decodeOr(tokenInterface, 'balanceOf', balances[i * 3], 0n);
      const debt = decodeOr(tokenInterface, 'balanceOf', balances[i * 3 + 1], 0n) + decodeOr(tokenInterface, 'balanceOf', balances[i * 3 + 2], 0n);
      if (debt > 0n) hasDebt = true;
      if (supply > 0n) supplied.push({ ...reserve, supply });
    });
    if (supplied.length === 0) return [];

    const meta = await readMany(provider, supplied.flatMap((r) => [
      { target: r.asset, data: tokenInterface.encodeFunctionData('symbol') },
      { target: r.asset, data: tokenInterface.encodeFunctionData('decimals') }
    ]));

    return supplied.map((reserve, i) => {
      const symbol = decodeOr(tokenInterface, 'symbol', meta[i * 2], 'TOKEN');
      const decimals = decodeOr(tokenInterface, 'decimals', meta[i * 2 + 1], 18n);
      return {
        id: `aave:${reserve.aToken.toLowerCase()}`,
        adapter: 'aave-v3',
        title: `Aave v3: ${symbol} supplied`,
        details: [`${ethers.formatUnits(reserve.supply, decimals)} ${symbol}`],
        warning: hasDebt
          ? 'This account also has Aave debt. A withdrawal that would leave the debt under-collateralized fails in simulation, so nothing is sent.'
          : null,
        covers: [erc20Key(reserve.aToken)],
        actions: [
          {
            id: 'withdraw',
            label: `Withdraw ${symbol} to safe wallet`,
            description: 'Withdraws the full balance, including interest up to the moment it runs, and sends the underlying token straight to the safe wallet.'
          },
          {
            id: 'transfer-atoken',
            label: `Move a${symbol} to safe wallet`,
            description: 'Use when the pool lacks liquidity to withdraw. Interest earned after the scan stays behind as dust.'
          }
        ],
        data: { pool, asset: reserve.asset, aToken: reserve.aToken, supply: reserve.supply, symbol }
      };
    });
  },

  buildCalls(position, actionId, { to }) {
    const { data } = position;
    if (actionId === 'withdraw') {
      return [{
        target: data.pool,
        value: 0n,
        data: poolInterface.encodeFunctionData('withdraw', [data.asset, ethers.MaxUint256, to]),
        contractName: 'Aave v3 Pool',
        functionName: 'withdraw',
        args: [data.symbol, 'full balance', to],
        source: 'position',
        covers: position.covers
      }];
    }
    if (actionId === 'transfer-atoken') {
      return [{
        target: data.aToken,
        value: 0n,
        data: tokenInterface.encodeFunctionData('transfer', [to, data.supply]),
        contractName: `a${data.symbol}`,
        functionName: 'transfer',
        args: [to, data.supply.toString()],
        source: 'position',
        covers: position.covers
      }];
    }
    throw new Error(`Unknown Aave action ${actionId}`);
  }
};
