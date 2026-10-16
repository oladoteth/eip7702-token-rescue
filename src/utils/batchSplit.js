/**
 * Splits a batch that is too large for one transaction into parts, and sends them.
 *
 * Each part is its own type-4 transaction that carries a fresh authorization, so every part
 * re-applies the delegation even if the attacker re-delegates the account in between. The
 * rescue wallet's nonces and the authorization nonces both count up by one per part: each
 * processed authorization bumps the compromised account's nonce, so the next one stays valid.
 */

import { buildRescueTx, estimateRescueGas, isDelegatedTo, describeRescueError, skippedCallIndexes } from './rescueTx.js';

/**
 * @param {Error} error - From estimateRescueGas or a node
 * @returns {'too-large'|'empty-revert'|'revert'|'other'}
 *   empty-revert: a revert with no reason. Nodes simulate an estimate with gas capped at the
 *   block limit, so a batch that is too large shows up as an inner call running out of gas
 *   (CallFailed with empty data) or the whole transaction running out of gas (no revert data
 *   at all; the delegate itself always reverts with data).
 */
export function classifyEstimateError(error) {
  const message = error?.message ?? String(error);
  if (/in the batch reverted: (0x|no reason given)\s*$/i.test(message) || /missing revert data/i.test(message)) return 'empty-revert';
  if (/in the batch reverted/i.test(message)) return 'revert';
  if (/more than one transaction can use|gas required exceeds|exceeds block gas limit|exceeds the configured cap|intrinsic gas too high|out of gas|gas limit reached/i.test(message)) {
    return 'too-large';
  }
  return 'other';
}

/**
 * Finds how many calls from the start of `calls` fit in one transaction (binary search).
 * Gas grows with every call, so if a prefix fits, every shorter prefix fits too.
 * @param {Array} calls
 * @param {(calls: Array) => Promise<{gasLimit: bigint}>} tryEstimate - Throws when the calls
 *   revert or do not fit
 * @returns {Promise<{count: number, gasLimit: bigint}>}
 */
export async function largestFittingPrefix(calls, tryEstimate) {
  const attempt = async (count) => {
    try {
      return { fits: true, gasLimit: (await tryEstimate(calls.slice(0, count))).gasLimit };
    } catch (error) {
      const kind = classifyEstimateError(error);
      // With more than one call, a reason-less revert is most likely the gas cap: shrink.
      // A single call that reverts with no reason is a real failure.
      if (kind === 'too-large' || (kind === 'empty-revert' && count > 1)) return { fits: false };
      throw error;
    }
  };

  const whole = await attempt(calls.length);
  if (whole.fits) return { count: calls.length, gasLimit: whole.gasLimit };

  const single = await attempt(1);
  if (!single.fits) {
    throw new Error(`${calls[0].contractName ?? 'A call'}: ${calls[0].functionName ?? 'call'} alone needs more gas than one transaction can use.`);
  }
  let lo = 1;
  let loGas = single.gasLimit;
  let hi = calls.length;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const result = await attempt(mid);
    if (result.fits) {
      lo = mid;
      loGas = result.gasLimit;
    } else {
      hi = mid;
    }
  }
  return { count: lo, gasLimit: loGas };
}

/**
 * Plans the parts, each estimated against the current chain state. If a later part reverts,
 * it may depend on an earlier part (for example, moving tokens an earlier unstake releases),
 * so planning stops there with `rest` set, to be planned again once earlier parts are mined.
 * @returns {Promise<{parts: Array<{calls: Array, gasLimit: bigint}>, rest: Array}>}
 */
export async function planParts(calls, tryEstimate) {
  const parts = [];
  let remaining = calls;
  while (remaining.length > 0) {
    let fit;
    try {
      fit = await largestFittingPrefix(remaining, tryEstimate);
    } catch (error) {
      if (parts.length > 0 && ['revert', 'empty-revert'].includes(classifyEstimateError(error))) {
        return { parts, rest: remaining };
      }
      throw error;
    }
    parts.push({ calls: remaining.slice(0, fit.count), gasLimit: fit.gasLimit });
    remaining = remaining.slice(fit.count);
  }
  return { parts, rest: [] };
}

/**
 * Estimator for planParts that simulates the real rescue transaction for a list of calls.
 * @returns {(calls: Array) => Promise<{gasLimit: bigint}>}
 */
export function rescueEstimator({ compromised, payerAddress, delegateAddress }) {
  return async (calls) => {
    const tx = await buildRescueTx({ compromised, delegateAddress, calls });
    return estimateRescueGas(compromised.provider, tx, payerAddress);
  };
}

/**
 * Sends a batch in as many transactions as it needs, and waits for each one.
 * @param {object} params
 * @param {ethers.Wallet} params.compromised - Signs the authorizations
 * @param {ethers.Wallet} params.payer - Sends the transactions and pays gas
 * @param {string} params.delegateAddress
 * @param {Array} params.calls
 * @param {{maxFeePerGas?: bigint, maxPriorityFeePerGas?: bigint}} [params.fees]
 * @param {(parts: Array) => void} [params.onUpdate] - Called with the progress list
 * @returns {Promise<Array<{index: number, calls: number, hash: string|null, status: string, delegated?: boolean, skipped?: number, error?: string}>>}
 *   skipped: approval revokes in that part that failed and were skipped
 */
export async function executeInParts({ compromised, payer, delegateAddress, calls, fees = {}, onUpdate = () => {} }) {
  const provider = payer.provider;
  const estimate = rescueEstimator({ compromised, payerAddress: payer.address, delegateAddress });
  const progress = [];
  const report = () => onUpdate(progress.map((p) => ({ ...p })));

  let remaining = calls;
  while (remaining.length > 0) {
    const { parts, rest } = await planParts(remaining, estimate);
    const payerNonce = await provider.getTransactionCount(payer.address, 'pending');
    const authNonce = await provider.getTransactionCount(compromised.address, 'pending');

    // Send this round's parts back to back so they land in the same or adjacent blocks.
    const sent = [];
    for (let i = 0; i < parts.length; i++) {
      const entry = { index: progress.length, calls: parts[i].calls.length, hash: null, status: 'signing' };
      progress.push(entry);
      report();
      try {
        const tx = await buildRescueTx({ compromised, delegateAddress, calls: parts[i].calls, authorizationNonce: authNonce + i });
        const response = await payer.sendTransaction({ ...tx, ...fees, gasLimit: parts[i].gasLimit, nonce: payerNonce + i });
        entry.hash = response.hash;
        entry.status = 'sent';
        sent.push(entry);
      } catch (error) {
        entry.status = 'failed';
        entry.error = describeRescueError(error);
        report();
        // Later parts would use nonces that are now never filled, so stop here.
        for (const s of sent) await waitFor(provider, s, compromised.address, delegateAddress, report);
        return progress;
      }
      report();
    }

    for (const entry of sent) {
      await waitFor(provider, entry, compromised.address, delegateAddress, report);
    }
    if (sent.some((e) => e.status !== 'confirmed')) return progress;
    remaining = rest;
  }
  return progress;
}

const RECEIPT_POLL_MS = 1500;
const RECEIPT_TIMEOUT_MS = 180000;

async function waitFor(provider, entry, account, delegateAddress, report) {
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  let receipt = null;
  while (!receipt && Date.now() < deadline) {
    receipt = await provider.getTransactionReceipt(entry.hash);
    if (!receipt) await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_MS));
  }
  if (!receipt) {
    entry.status = 'timeout';
  } else if (receipt.status !== 1) {
    entry.status = 'reverted';
  } else {
    // A stale authorization is skipped without failing the tx, and then nothing moves.
    entry.delegated = await isDelegatedTo(provider, account, delegateAddress);
    entry.status = entry.delegated ? 'confirmed' : 'not-delegated';
    entry.skipped = skippedCallIndexes(receipt, account).length;
  }
  report();
}
