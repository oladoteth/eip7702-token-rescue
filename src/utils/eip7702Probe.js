/**
 * Detects whether a chain processes EIP-7702 authorizations.
 * Uses only eth_estimateGas with a throwaway key: nothing is signed for a real account and
 * nothing is sent.
 */

import { ethers } from 'ethers';

// Multicall3 is deployed at this address on most EVM chains. It has no fallback or receive
// function, so an empty call to an account delegated to it must revert.
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
// Smallest charge for one authorization tuple (PER_AUTH_BASE_COST after refund).
const MIN_AUTHORIZATION_GAS = 12500n;

function describe(error) {
  return error?.shortMessage || error?.message || String(error);
}

/**
 * @param {ethers.Provider} provider
 * @returns {Promise<{supported: boolean|null, reason: string}>} supported is null when the
 *   chain could not be checked (the RPC failed), so callers can tell "no" from "unknown".
 */
export async function probeEip7702(provider) {
  let chainId;
  try {
    ({ chainId } = await provider.getNetwork());
  } catch (error) {
    return { supported: null, reason: `RPC unavailable: ${describe(error)}` };
  }

  const throwaway = ethers.Wallet.createRandom();
  // A separate sender, as in a real rescue. If the sender were the authority itself, its
  // nonce is bumped before authorizations are processed, so nonce 0 would be invalid.
  const sponsor = ethers.Wallet.createRandom().address;
  const typeFour = (delegate) => ({
    type: 4,
    from: sponsor,
    to: throwaway.address,
    value: 0n,
    authorizationList: [throwaway.authorizeSync({ address: delegate, nonce: 0n, chainId })]
  });

  // Behaviour check: with the delegation applied, the account runs Multicall3's code.
  let hasMulticall = false;
  try {
    hasMulticall = (await provider.getCode(MULTICALL3)) !== '0x';
  } catch (error) {
    return { supported: null, reason: `RPC unavailable: ${describe(error)}` };
  }
  if (hasMulticall) {
    try {
      await provider.estimateGas(typeFour(MULTICALL3));
      return { supported: false, reason: 'The authorization had no effect: the account kept no code' };
    } catch (error) {
      if (error?.code === 'CALL_EXCEPTION' || /revert/i.test(describe(error))) {
        return { supported: true, reason: 'The delegated code ran' };
      }
      return { supported: false, reason: `Type-4 transactions rejected: ${describe(error)}` };
    }
  }

  // Cost check where Multicall3 is missing: compare with the same call without the
  // authorization, so chains that fold other costs into gas (zkSync, Arbitrum) compare fairly.
  try {
    const withAuthorization = await provider.estimateGas(typeFour(ethers.ZeroAddress));
    const control = await provider.estimateGas({ from: sponsor, to: throwaway.address, value: 0n });
    return withAuthorization - control >= MIN_AUTHORIZATION_GAS
      ? { supported: true, reason: `The authorization was charged (${withAuthorization - control} gas)` }
      : { supported: false, reason: 'The authorization was ignored' };
  } catch (error) {
    return { supported: false, reason: `Type-4 transactions rejected: ${describe(error)}` };
  }
}
