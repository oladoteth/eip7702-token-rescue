import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { encodeBatchExecuteCalls } from '../utils/contracts';
import { TransactionStatusModal } from './TransactionStatusModal';
import { ethers } from 'ethers';

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
      // Step 1: Encode batch execution call
      setStatus('Encoding batch execution...');
      const batchData = encodeBatchExecuteCalls(batchCalls);
      
      // Calculate total value from batch calls (sum of all call values)
      const totalValue = gasSettings?.totalValue || batchCalls.reduce((sum, call) => {
        try {
          return sum + BigInt(call.value || 0);
        } catch {
          return sum;
        }
      }, 0n);

      // Step 2: Estimate gas for the batcher call
      setStatus('Estimating gas...');
      
      // Use gas settings from GasSettings component
      let maxFeePerGas, maxPriorityFeePerGas, gasLimit;
      if (gasSettings) {
        maxFeePerGas = gasSettings.maxFeePerGas;
        maxPriorityFeePerGas = gasSettings.maxPriorityFeePerGas;
        gasLimit = gasSettings.gasLimit;
      } else {
        // Fallback to automatic
        const feeData = await provider.getFeeData();
        maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits('1', 'gwei');
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei');
        gasLimit = 600000n;
      }

      const compromisedNonce = await compromisedWallet.getNonce();
      const authorizationRequest = {
        address: batcherContract.address,
        nonce: compromisedNonce,
        chainId: currentChain.chainId,
      };
      const authorization = await compromisedWallet.authorize(authorizationRequest);

      // Step 3: Send transaction from rescue wallet to compromised wallet
      // Transaction structure: rescue wallet -> compromised wallet
      // Data: batcher execution data (batchExecuteCalls with targets, datas, values)
      setStatus('Sending transaction from rescue wallet to compromised wallet...');
      
      // Get nonce for rescue wallet (the one paying gas)
      let nonce = await rescueWallet.getNonce();
      
      // Build transaction: rescue wallet -> compromised wallet
      // The data contains the batcher contract execution call
      const txRequest = {
        to: compromisedWallet.address, // Transaction TO compromised wallet
        data: batchData, // Batcher execution data (batchExecuteCalls encoded)
        value: totalValue, // Total value from batch calls
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasLimit,
        type: 4, // EIP-7702 transaction type
        authorizationList: [authorization], // Include the authorization for delegation
        nonce: nonce++,
        chainId: currentChain.chainId,
        from: rescueWallet.address
      };

      // Sign and send transaction using rescue wallet (pays gas)
      const tx = await rescueWallet.wallet.sendTransaction(txRequest);
      
      setTxHash(tx.hash);
      setStatus(`Transaction submitted! Hash: ${tx.hash}`);
      setShowModal(true);
    } catch (err) {
      setError(err.message);
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
          <li>Encode batch transaction data from your batch calls</li>
          <li>Fund compromised wallet with ETH for gas (if needed)</li>
          <li>Call batcher contract from compromised wallet to execute batch</li>
          <li>Batcher contract executes all transactions in the batch</li>
        </ol>
        <p className="note">
          <strong>Note:</strong> The rescue wallet will automatically fund the compromised wallet 
          with enough ETH for gas if needed. The compromised wallet then calls the batcher contract 
          to execute the rescue transactions.
        </p>
      </div>

      {showModal && txHash && (
        <TransactionStatusModal
          txHash={txHash}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
