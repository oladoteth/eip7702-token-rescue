/**
 * Rescue transaction building.
 * Shared by the UI and scripts/e2e-rescue.mjs, so keep it free of React and DOM code.
 *
 * Providers passed in must be created with `cacheTimeout: -1`. By default ethers reuses
 * identical requests for 250ms, which returns pre-tx nonces and code on fast chains.
 */

import { ethers } from 'ethers';
import { RESCUE_DELEGATE_ABI, RESCUE_DELEGATE_BYTECODE } from '../contracts/rescueDelegate.js';
import { nftKey } from '../discovery/balances.js';

// Deterministic CREATE2 deployer (Arachnid). Present on most EVM chains and on anvil.
export const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

const delegateInterface = new ethers.Interface(RESCUE_DELEGATE_ABI);

// Leaves room for estimation error without paying for a large unused limit.
const GAS_BUFFER_PERCENT = 25n;

// Gas the delegate gives each optional call (RescueDelegate.OPTIONAL_CALL_GAS).
const OPTIONAL_CALL_GAS = 200_000n;

// EIP-7825 (Fusaka) caps one transaction at 2^24 gas on Ethereum, below the block gas
// limit. Applied on every chain: 16.7M gas is roughly 400 token transfers.
export const MAX_TX_GAS = 16_777_216n;

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
    // Only approval revokes are optional: a hostile token must not be able to sink the
    // rescue. Every other call stays all or nothing.
    return [call.target, BigInt(call.value ?? 0), call.data ?? '0x', call.source === 'revoke'];
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
 * @param {number} [params.authorizationNonce] - Nonce to sign the authorization for. Defaults to
 *   the account's pending nonce. Parts of a split batch use consecutive nonces.
 * @returns {Promise<object>} Transaction request without gas fields
 */
export async function buildRescueTx({ compromised, delegateAddress, calls, authorizationNonce }) {
  const provider = compromised.provider;
  const { chainId } = await provider.getNetwork();
  // 'pending' so a queued tx from the attacker does not leave us with a stale nonce.
  // A stale nonce makes the chain skip the authorization without failing the tx.
  const nonce = authorizationNonce ?? await provider.getTransactionCount(compromised.address, 'pending');
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
      if (parsed?.name === 'NotEnoughGasForOptionalCall') {
        return 'The gas limit is too low to run the approval revokes. Raise the gas limit.';
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
 * @returns {Promise<{estimate: bigint, gasLimit: bigint, maxGas: bigint}>} maxGas is the most
 *   one transaction may use here: the block gas limit or MAX_TX_GAS, whichever is lower.
 */
export async function estimateRescueGas(provider, tx, payerAddress) {
  let estimate;
  try {
    estimate = await provider.estimateGas({ ...tx, from: payerAddress });
  } catch (error) {
    throw new Error(describeRescueError(error));
  }
  // An optional call may use up to its full cap on-chain even if it used little in the
  // estimate, so that worst case is added on top, keeping the required calls covered.
  const [calls] = delegateInterface.decodeFunctionData('execute', tx.data);
  const optionalCalls = BigInt(calls.filter((c) => c.allowFailure).length);
  const gasLimit = estimate + (estimate * GAS_BUFFER_PERCENT) / 100n + optionalCalls * OPTIONAL_CALL_GAS;
  const block = await provider.getBlock('latest');
  const maxGas = block && block.gasLimit < MAX_TX_GAS ? block.gasLimit : MAX_TX_GAS;
  if (gasLimit > maxGas) {
    throw new Error(
      `The batch needs ${gasLimit} gas, more than one transaction can use (${maxGas}). ` +
      'It will be sent in parts.'
    );
  }
  return { estimate, gasLimit, maxGas };
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
  return erc20TransferCall({ token, to, amount: balance, symbol, decimals });
}

/**
 * ERC-20 transfer as a batch call, for a balance that was already read on-chain.
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.to - Safe wallet
 * @param {bigint} params.amount
 * @param {string} params.symbol
 * @param {number|bigint|null} params.decimals - null shows the raw amount
 * @returns {object} A batch call
 */
export function erc20TransferCall({ token, to, amount, symbol, decimals }) {
  const data = new ethers.Interface(['function transfer(address,uint256) returns (bool)'])
    .encodeFunctionData('transfer', [to, amount]);
  const shown = decimals == null ? amount.toString() : ethers.formatUnits(amount, decimals);
  return {
    target: token,
    value: 0n,
    data,
    contractName: symbol,
    functionName: 'transfer',
    args: [to, `${shown} ${symbol}`],
    source: 'erc20'
  };
}

const nftInterface = new ethers.Interface([
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)'
]);

/**
 * Batch calls that move NFTs to the safe wallet: one safeTransferFrom per ERC-721, and one
 * safeBatchTransferFrom per ERC-1155 collection (cheaper than one call per item).
 * safeTransferFrom makes the receiver check run, so a safe wallet that cannot hold NFTs
 * fails in simulation instead of losing them.
 * @param {Array<{type: string, token: string, tokenId: bigint, amount: bigint, name?: string}>} nfts
 * @param {string} from - Compromised wallet
 * @param {string} to - Safe wallet
 * @returns {object[]} Batch calls. Each has `nftKeys` listing the NFTs it moves.
 */
export function nftTransferCalls(nfts, from, to) {
  const calls = [];
  const byCollection = new Map();

  for (const nft of nfts) {
    if (nft.type === 'ERC-721') {
      calls.push({
        target: nft.token,
        value: 0n,
        data: nftInterface.encodeFunctionData('safeTransferFrom', [from, to, nft.tokenId]),
        contractName: nft.name || 'NFT',
        functionName: 'safeTransferFrom',
        args: [to, `#${nft.tokenId}`],
        source: 'erc721',
        nftKeys: [nftKey(nft.token, nft.tokenId)]
      });
    } else if (nft.type === 'ERC-1155') {
      const key = nft.token.toLowerCase();
      if (!byCollection.has(key)) byCollection.set(key, { token: nft.token, name: nft.name, items: [] });
      byCollection.get(key).items.push(nft);
    }
  }

  for (const { token, name, items } of byCollection.values()) {
    calls.push({
      target: token,
      value: 0n,
      data: nftInterface.encodeFunctionData('safeBatchTransferFrom', [
        from,
        to,
        items.map((i) => i.tokenId),
        items.map((i) => i.amount),
        '0x'
      ]),
      contractName: name || 'ERC-1155',
      functionName: 'safeBatchTransferFrom',
      args: [to, items.map((i) => `#${i.tokenId} x${i.amount}`).join(', ')],
      source: 'erc1155',
      nftKeys: items.map((i) => nftKey(token, i.tokenId))
    });
  }
  return calls;
}

/**
 * Batch call that sends the compromised account's whole native balance to the safe wallet.
 * The amount is read when the transaction runs, not now, so ETH that arrives or leaves in
 * between cannot make the rescue revert. Keep it last, after anything that releases ETH.
 * @param {string} compromisedAddress - The call targets the account itself
 * @param {string} to - Safe wallet
 * @param {string} symbol - Native coin symbol, for display
 * @returns {object} A batch call
 */
export function nativeSweepCall(compromisedAddress, to, symbol) {
  return {
    target: compromisedAddress,
    value: 0n,
    data: delegateInterface.encodeFunctionData('sweepNative', [to]),
    contractName: symbol,
    functionName: 'sweepNative',
    args: [to, `entire ${symbol} balance when the rescue runs`],
    source: 'native'
  };
}

const revokeInterface = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
  'function lockdown((address token, address spender)[] approvals)'
]);

/**
 * Key for one approval, so the same revoke is never added twice.
 * @returns {string}
 */
export function revokeKey(approval) {
  return `revoke:${approval.kind}:${approval.token.toLowerCase()}:${approval.spender.toLowerCase()}`;
}

/**
 * Batch calls that remove approvals confirmed by confirmApprovals: approve(spender, 0) for
 * ERC-20 allowances, setApprovalForAll(operator, false) for operators, and one Permit2
 * lockdown for every Permit2 allowance.
 * @param {Array<{kind: 'erc20'|'operator'|'permit2', token: string, spender: string, symbol?: string}>} approvals
 * @param {string} permit2 - Permit2 address
 * @returns {object[]} Batch calls with source 'revoke'
 */
export function revokeCalls(approvals, permit2) {
  const calls = [];
  for (const a of approvals) {
    if (a.kind === 'erc20') {
      calls.push({
        target: a.token,
        value: 0n,
        data: revokeInterface.encodeFunctionData('approve', [a.spender, 0n]),
        contractName: a.symbol || 'ERC-20',
        functionName: 'approve',
        args: [a.spender, '0 (revoke)'],
        source: 'revoke',
        covers: [revokeKey(a)]
      });
    } else if (a.kind === 'operator') {
      calls.push({
        target: a.token,
        value: 0n,
        data: revokeInterface.encodeFunctionData('setApprovalForAll', [a.spender, false]),
        contractName: a.symbol || 'NFT collection',
        functionName: 'setApprovalForAll',
        args: [a.spender, 'false (revoke)'],
        source: 'revoke',
        covers: [revokeKey(a)]
      });
    }
  }
  // One optional call has a fixed gas cap, so long lockdown lists are split.
  const allPermit2 = approvals.filter((a) => a.kind === 'permit2');
  for (let i = 0; i < allPermit2.length; i += 20) {
    const permit2Pairs = allPermit2.slice(i, i + 20);
    calls.push({
      target: permit2,
      value: 0n,
      data: revokeInterface.encodeFunctionData('lockdown', [permit2Pairs.map((a) => [a.token, a.spender])]),
      contractName: 'Permit2',
      functionName: 'lockdown',
      args: permit2Pairs.map((a) => `${a.symbol || a.token} -> ${a.spender}`),
      source: 'revoke',
      covers: permit2Pairs.map(revokeKey)
    });
  }
  return calls;
}

/**
 * Indexes of optional calls (approval revokes) that failed and were skipped in a mined
 * rescue transaction.
 * @param {ethers.TransactionReceipt} receipt
 * @param {string} account - Compromised account (the delegate emits from it)
 * @returns {number[]}
 */
export function skippedCallIndexes(receipt, account) {
  const topic = delegateInterface.getEvent('CallSkipped').topicHash;
  return receipt.logs
    .filter((log) => log.address.toLowerCase() === account.toLowerCase() && log.topics[0] === topic)
    .map((log) => Number(BigInt(log.topics[1])));
}
