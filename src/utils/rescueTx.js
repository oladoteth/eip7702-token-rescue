/**
 * Rescue transaction building.
 * Shared by the UI and scripts/e2e-rescue.mjs, so keep it free of React and DOM code.
 *
 * Providers passed in must be created with `cacheTimeout: -1`. By default ethers reuses
 * identical requests for 250ms, which returns pre-tx nonces and code on fast chains.
 */

import { ethers } from 'ethers';
import { RESCUE_DELEGATE_ABI, RESCUE_DELEGATE_BYTECODE } from '../contracts/rescueDelegate.js';

// Deterministic CREATE2 deployer (Arachnid). Present on most EVM chains and on anvil.
export const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

const delegateInterface = new ethers.Interface(RESCUE_DELEGATE_ABI);

// Leaves room for estimation error without paying for a large unused limit.
const GAS_BUFFER_PERCENT = 25n;

function delegateInitCode(controller) {
  const args = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [controller]);
  return ethers.concat([RESCUE_DELEGATE_BYTECODE, args]);
}

/**
 * Address of the RescueDelegate whose controller is `controller`. Same on every chain.
 * @param {string} controller - Gas payer address (the only address allowed to execute)
 * @returns {string}
 */
export function predictDelegateAddress(controller) {
  return ethers.getCreate2Address(
    CREATE2_DEPLOYER,
    ethers.ZeroHash,
    ethers.keccak256(delegateInitCode(controller))
  );
}

/**
 * Deploys the payer's RescueDelegate through the CREATE2 deployer if it is not there yet.
 * @param {ethers.Wallet} payer - Connected wallet that pays gas and becomes the controller
 * @returns {Promise<{address: string, txHash: string|null}>} txHash is null when it already existed
 */
export async function ensureDelegateDeployed(payer) {
  const provider = payer.provider;
  const address = predictDelegateAddress(payer.address);

  if ((await provider.getCode(address)) !== '0x') {
    return { address, txHash: null };
  }
  if ((await provider.getCode(CREATE2_DEPLOYER)) === '0x') {
    throw new Error(`The CREATE2 deployer ${CREATE2_DEPLOYER} is not deployed on this chain.`);
  }

  const tx = await payer.sendTransaction({
    to: CREATE2_DEPLOYER,
    data: ethers.concat([ethers.ZeroHash, delegateInitCode(payer.address)])
  });
  const receipt = await tx.wait();
  if (receipt.status !== 1 || (await provider.getCode(address)) === '0x') {
    throw new Error(
      `Delegate deployment failed (status ${receipt.status}, gas used ${receipt.gasUsed} of ${tx.gasLimit}). Transaction: ${tx.hash}`
    );
  }
  return { address, txHash: tx.hash };
}

/**
 * Encodes RescueDelegate.execute for a list of calls.
 * @param {Array<{target: string, value?: bigint, data?: string}>} calls
 * @returns {string}
 */
export function encodeExecute(calls) {
  if (!Array.isArray(calls) || calls.length === 0) {
    throw new Error('The batch is empty');
  }
  const tuples = calls.map((call) => {
    if (!ethers.isAddress(call.target)) {
      throw new Error(`Invalid target address: ${call.target}`);
    }
    return [call.target, BigInt(call.value ?? 0), call.data ?? '0x'];
  });
  return delegateInterface.encodeFunctionData('execute', [tuples]);
}

/**
 * Builds the EIP-7702 rescue transaction. The payer sends it to the compromised address,
 * carrying the compromised wallet's authorization to delegate to `delegateAddress`.
 * @param {object} params
 * @param {ethers.Wallet} params.compromised - Connected compromised wallet (signs the authorization)
 * @param {string} params.delegateAddress - Payer's RescueDelegate address
 * @param {Array} params.calls - Calls run as the compromised account
 * @returns {Promise<object>} Transaction request without gas fields
 */
export async function buildRescueTx({ compromised, delegateAddress, calls }) {
  const provider = compromised.provider;
  const { chainId } = await provider.getNetwork();
  // 'pending' so a queued tx from the attacker does not leave us with a stale nonce.
  // A stale nonce makes the chain skip the authorization without failing the tx.
  const nonce = await provider.getTransactionCount(compromised.address, 'pending');
  const authorization = await compromised.authorize({ address: delegateAddress, nonce, chainId });

  return {
    type: 4,
    to: compromised.address,
    data: encodeExecute(calls),
    value: 0n,
    chainId,
    authorizationList: [authorization]
  };
}

/**
 * Turns RescueDelegate revert data into a readable message.
 * @param {Error} error - Error from estimateGas, call or sendTransaction
 * @returns {string}
 */
export function describeRescueError(error) {
  const data = error?.data ?? error?.info?.error?.data ?? error?.error?.data;
  if (typeof data === 'string' && data.length >= 10) {
    try {
      const parsed = delegateInterface.parseError(data);
      if (parsed?.name === 'NotController') {
        return 'The gas payer is not the controller of this delegate.';
      }
      if (parsed?.name === 'CallFailed') {
        const [index, reason] = parsed.args;
        let detail = reason;
        try {
          detail = ethers.AbiCoder.defaultAbiCoder().decode(['string'], ethers.dataSlice(reason, 4))[0];
        } catch {
          // Custom error or empty revert, keep the raw data.
        }
        return `Call #${Number(index) + 1} in the batch reverted: ${detail || 'no reason given'}`;
      }
    } catch {
      // Not a RescueDelegate error, fall through.
    }
  }
  return error?.shortMessage || error?.message || String(error);
}

/**
 * Simulates the rescue and returns a buffered gas limit. Throws a readable error
 * if the batch would revert.
 * @param {ethers.Provider} provider
 * @param {object} tx - Result of buildRescueTx
 * @param {string} payerAddress
 * @returns {Promise<{estimate: bigint, gasLimit: bigint}>}
 */
export async function estimateRescueGas(provider, tx, payerAddress) {
  let estimate;
  try {
    estimate = await provider.estimateGas({ ...tx, from: payerAddress });
  } catch (error) {
    throw new Error(describeRescueError(error));
  }
  const gasLimit = estimate + (estimate * GAS_BUFFER_PERCENT) / 100n;
  const block = await provider.getBlock('latest');
  if (block && gasLimit > block.gasLimit) {
    throw new Error(`The batch needs ${gasLimit} gas, more than the block gas limit of ${block.gasLimit}. Split it into smaller batches.`);
  }
  return { estimate, gasLimit };
}

/**
 * Confirms that the compromised account now points at our delegate. An authorization
 * with a stale nonce is skipped by the chain without failing the tx, and then the call
 * does nothing, so a "success" receipt alone does not prove the rescue ran.
 * @returns {Promise<boolean>}
 */
export async function isDelegatedTo(provider, account, delegateAddress) {
  const code = await provider.getCode(account);
  return code.toLowerCase() === ethers.concat(['0xef0100', delegateAddress]).toLowerCase();
}

/**
 * ERC-20 transfer of the full balance to the safe wallet.
 * @returns {Promise<object>} A batch call
 */
export async function buildErc20SweepCall(provider, token, from, to) {
  const erc20 = new ethers.Contract(
    token,
    [
      'function balanceOf(address) view returns (uint256)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)'
    ],
    provider
  );
  const [balance, symbol, decimals] = await Promise.all([
    erc20.balanceOf(from),
    erc20.symbol().catch(() => 'TOKEN'),
    erc20.decimals().catch(() => 18n)
  ]);
  if (balance === 0n) {
    throw new Error(`${symbol} balance is zero`);
  }
  const data = new ethers.Interface(['function transfer(address,uint256) returns (bool)'])
    .encodeFunctionData('transfer', [to, balance]);
  return {
    target: token,
    value: 0n,
    data,
    contractName: symbol,
    functionName: 'transfer',
    args: [to, `${ethers.formatUnits(balance, decimals)} ${symbol}`],
    source: 'erc20'
  };
}
