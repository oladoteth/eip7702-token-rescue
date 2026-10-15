import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { buildRescueTx, describeRescueError } from '../utils/rescueTx';
import { TransactionStatusModal } from './TransactionStatusModal';

export function RescueExecutor({ gasSettings }) {
  const {
    rescueWallet,
    compromisedWallet,
    batcherContract,
    batchCalls,
    currentChain,
    provider
  } = useApp();

  const [executing, setExecuting] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [showModal, setShowModal] = useState(false);

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
      setError('Batcher contract address not set');
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

    try {
      // The compromised key signs an EIP-7702 authorization to our delegate. The rescue
      // wallet sends one type-4 tx to the compromised address and pays all the gas.
      setStatus('Signing delegation with the compromised wallet...');
      const txRequest = await buildRescueTx({
        compromised: compromisedWallet.wallet,
        delegateAddress: batcherContract.address,
        calls: batchCalls
      });

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
            <a 
              href={`${currentChain?.explorer}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {txHash}
            </a>
          </div>
        )}
      </div>

      {!gasSettings && (
        <div className="warning">
          ⚠️ Please configure gas settings before executing.
        </div>
      )}

      <button
        onClick={handleExecuteRescue}
        disabled={executing || !batcherContract || batchCalls.length === 0 || !gasSettings || !rescueWallet}
        className="execute-button"
      >
        {executing ? 'Executing Rescue...' : 'Execute Rescue Transaction'}
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
