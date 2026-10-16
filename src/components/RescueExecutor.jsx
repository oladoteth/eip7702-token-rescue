import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { buildRescueTx, describeRescueError, estimateRescueGas } from '../utils/rescueTx';
import { executeInParts } from '../utils/batchSplit';

const PART_STATUS = {
  signing: 'Signing',
  sent: 'Sent, waiting for confirmation',
  confirmed: 'Confirmed',
  reverted: 'Reverted',
  failed: 'Not sent',
  timeout: 'No receipt yet: check the explorer',
  'not-delegated': 'Mined, but the delegation was not applied, so its calls did not run'
};
import { reviewCall } from '../utils/callReview';
import { TransactionStatusModal } from './TransactionStatusModal';

export function RescueExecutor({ gasSettings }) {
  const {
    rescueWallet,
    compromisedWallet,
    batcherContract,
    batchCalls,
    currentChain,
    provider,
    safeWallet
  } = useApp();

  const reviews = useMemo(
    () => batchCalls.map((call) => reviewCall(call, safeWallet.address)),
    [batchCalls, safeWallet?.address]
  );
  const dangerCount = reviews.filter((review) => review.level === 'danger').length;
  const unknownCount = reviews.filter((review) => review.level === 'unknown').length;
  const [acknowledged, setAcknowledged] = useState(false);

  // Any change to the batch or destination needs a fresh review.
  useEffect(() => {
    setAcknowledged(false);
  }, [batchCalls, safeWallet?.address]);

  const [executing, setExecuting] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [parts, setParts] = useState(null);

  const handleExecuteRescue = async () => {
    if (!rescueWallet) {
      setError('Rescue wallet not set. Please setup rescue wallet first.');
      return;
    }

    if (!compromisedWallet) {
      setError('Compromised wallet not set');
      return;
    }

    if (!batcherContract) {
      setError('Rescue delegate is not deployed');
      return;
    }

    if (batchCalls.length === 0) {
      setError('No batch calls to execute');
      return;
    }

    if (!provider) {
      setError('Provider not available. Please select a chain.');
      return;
    }

    setExecuting(true);
    setError(null);
    setStatus('Preparing rescue transaction...');
    setTxHash(null);

    if (gasSettings.split) {
      setParts([]);
      try {
        setStatus('Sending the rescue in parts...');
        const progress = await executeInParts({
          compromised: compromisedWallet.wallet,
          payer: rescueWallet.wallet,
          delegateAddress: batcherContract.address,
          calls: batchCalls,
          fees: { maxFeePerGas: gasSettings.maxFeePerGas, maxPriorityFeePerGas: gasSettings.maxPriorityFeePerGas },
          onUpdate: setParts
        });
        const confirmed = progress.filter((p) => p.status === 'confirmed').length;
        const skipped = progress.reduce((sum, p) => sum + (p.skipped ?? 0), 0);
        if (confirmed === progress.length && progress.length > 0) {
          setStatus(`Rescue confirmed in ${confirmed} transactions.` + (skipped ? ` ${skipped} approval revoke(s) failed and were skipped.` : ''));
        } else {
          setStatus(null);
          setError(`${confirmed} of ${progress.length} parts confirmed. Assets in confirmed parts are at the safe wallet; see the list below for the rest.`);
        }
      } catch (err) {
        setError(describeRescueError(err));
        setStatus(null);
        console.error('Rescue execution error:', err);
      } finally {
        setExecuting(false);
      }
      return;
    }

    try {
      // The compromised key signs an EIP-7702 authorization to our delegate. The rescue
      // wallet sends one type-4 tx to the compromised address and pays all the gas.
      setStatus('Signing delegation with the compromised wallet...');
      const txRequest = await buildRescueTx({
        compromised: compromisedWallet.wallet,
        delegateAddress: batcherContract.address,
        calls: batchCalls
      });

      // Simulate again right before sending: balances may have changed since the gas
      // estimate, and a reverting batch would still cost the rescue wallet gas.
      setStatus('Simulating the rescue...');
      await estimateRescueGas(provider, txRequest, rescueWallet.address);

      setStatus('Sending rescue transaction from the rescue wallet...');
      const tx = await rescueWallet.wallet.sendTransaction({
        ...txRequest,
        gasLimit: gasSettings.gasLimit,
        maxFeePerGas: gasSettings.maxFeePerGas,
        maxPriorityFeePerGas: gasSettings.maxPriorityFeePerGas
      });

      setTxHash(tx.hash);
      setStatus(`Transaction submitted! Hash: ${tx.hash}`);
      setShowModal(true);
    } catch (err) {
      setError(describeRescueError(err));
      setStatus(null);
      console.error('Rescue execution error:', err);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="rescue-executor">
      <h3>Execute Rescue</h3>

      <div className="execution-status">
        {status && <div className="status">{status}</div>}
        {error && <div className="error">{error}</div>}
        {txHash && (
          <div className="tx-hash">
            <strong>Transaction Hash:</strong>
            {currentChain?.explorer && (
              <a 
                href={`${currentChain?.explorer}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {txHash}
              </a>
            )}
            {!currentChain?.explorer && <code>{txHash}</code>}
          </div>
        )}
      </div>

      {!gasSettings && (
        <div className="warning">
          ⚠️ Please configure gas settings before executing.
        </div>
      )}

      {parts && parts.length > 0 && (
        <ol className="review-list part-list">
          {parts.map((part) => (
            <li key={part.index} className={`review-item review-${part.status === 'confirmed' ? 'ok' : ['sent', 'signing'].includes(part.status) ? 'unknown' : 'danger'}`}>
              <strong>Part {part.index + 1}: {part.calls} calls</strong> {PART_STATUS[part.status] ?? part.status}
              {part.hash && (
                <p>
                  {currentChain?.explorer
                    ? <a href={`${currentChain.explorer}/tx/${part.hash}`} target="_blank" rel="noopener noreferrer">{part.hash}</a>
                    : <code>{part.hash}</code>}
                </p>
              )}
              {part.skipped > 0 && <p>{part.skipped} approval revoke(s) failed and were skipped.</p>}
              {part.error && <p>{part.error}</p>}
            </li>
          ))}
        </ol>
      )}

      <div className="batch-review">
        <h4>Review Before Sending</h4>
        <p>
          Destination check against your safe wallet <code>{safeWallet.address}</code>.
        </p>
        <ol className="review-list">
          {batchCalls.map((call, index) => (
            <li key={index} className={`review-item review-${reviews[index].level}`}>
              <strong>#{index + 1} {call.contractName || call.target}: {reviews[index].action}</strong>
              {reviews[index].recipient && (
                <span> to <code>{reviews[index].recipient}</code></span>
              )}
              <p>{reviews[index].message}</p>
            </li>
          ))}
        </ol>
        {dangerCount > 0 && (
          <div className="error">
            {dangerCount > 1 ? `${dangerCount} calls in this batch send` : '1 call in this batch sends'} assets
            or approvals to an address that is not your safe wallet. If someone sent you this calldata, do not continue.
          </div>
        )}
        <label className="review-ack">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />{' '}
          {dangerCount > 0
            ? `I understand that ${dangerCount} call${dangerCount > 1 ? 's' : ''} will send assets or approvals away from my safe wallet.`
            : unknownCount > 0
              ? `I have reviewed every call, including ${unknownCount} that could not be checked automatically, and I trust where they came from.`
              : 'I have reviewed every call in this batch.'}
        </label>
      </div>

      <button
        onClick={handleExecuteRescue}
        disabled={executing || !acknowledged || !batcherContract || batchCalls.length === 0 || !gasSettings || !rescueWallet}
        className="execute-button"
      >
        {executing
          ? 'Executing Rescue...'
          : gasSettings?.split
            ? `Execute in ${gasSettings.partsKnown ? gasSettings.parts : `${gasSettings.parts}+`} Transactions`
            : 'Execute Rescue Transaction'}
      </button>

      <div className="info-box">
        <h4>Rescue Process:</h4>
        <ol>
          <li>The compromised wallet signs an EIP-7702 authorization to the rescue delegate (offline, no gas)</li>
          <li>The rescue wallet sends one transaction to the compromised address with that authorization</li>
          <li>The compromised account runs every call in the batch, in order</li>
          <li>If any call fails, the whole batch reverts and nothing moves</li>
        </ol>
        <p className="note">
          <strong>Note:</strong> No ETH is ever sent to the compromised wallet, so a sweeper bot has
          nothing to take. The rescue wallet pays all the gas.
        </p>
      </div>

      {showModal && txHash && (
        <TransactionStatusModal
          txHash={txHash}
          compromisedAddress={compromisedWallet.address}
          delegateAddress={batcherContract.address}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
