import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { encodeFunctionCall, encodeBatchExecuteCalls, ERC20_ABI, ERC721_ABI } from '../utils/contracts';
import { ethers } from 'ethers';

export function BatchBuilder() {
  const { contracts, batchCalls, addBatchCall, removeBatchCall, clearBatchCalls, compromisedWallet } = useApp();
  const [selectedContract, setSelectedContract] = useState('');
  const [selectedFunction, setSelectedFunction] = useState('');
  const [functionParams, setFunctionParams] = useState('');
  const [callValue, setCallValue] = useState('0');
  const [error, setError] = useState(null);

  const selectedContractData = contracts.find(c => c.address === selectedContract);

  const handleAddCall = () => {
    setError(null);

    if (!selectedContract) {
      setError('Please select a contract');
      return;
    }

    if (!selectedFunction) {
      setError('Please select a function');
      return;
    }

    try {
      let params = [];
      if (functionParams.trim()) {
        params = JSON.parse(`[${functionParams}]`);
      }

      const data = encodeFunctionCall(selectedContractData.abi, selectedFunction, params);
      
      addBatchCall({
        target: selectedContract,
        data,
        value: ethers.parseEther(callValue || '0'),
        contractName: selectedContractData.name,
        functionName: selectedFunction,
        params
      });

      // Reset form
      setSelectedFunction('');
      setFunctionParams('');
      setCallValue('0');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleBuildBatch = () => {
    if (batchCalls.length === 0) {
      setError('No calls to batch');
      return;
    }

    try {
      const batchData = encodeBatchExecuteCalls(batchCalls);
      console.log('Batch data:', batchData);
      // This will be used when submitting the transaction
      return batchData;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  const availableFunctions = selectedContractData
    ? selectedContractData.abi.filter(item => item.type === 'function' && item.stateMutability !== 'view')
    : [];

  return (
    <div className="batch-builder">
      <h3>Build Batch Transactions</h3>

      {contracts.length === 0 ? (
        <p>Load contracts first to build batches</p>
      ) : (
        <>
          <div className="batch-form">
            <select
              value={selectedContract}
              onChange={(e) => {
                setSelectedContract(e.target.value);
                setSelectedFunction('');
              }}
            >
              <option value="">Select Contract</option>
              {contracts.map((contract, index) => (
                <option key={index} value={contract.address}>
                  {contract.name} ({contract.address.slice(0, 10)}...)
                </option>
              ))}
            </select>

            {selectedContract && (
              <>
                <select
                  value={selectedFunction}
                  onChange={(e) => setSelectedFunction(e.target.value)}
                >
                  <option value="">Select Function</option>
                  {availableFunctions.map((func, index) => (
                    <option key={index} value={func.name}>
                      {func.name}({func.inputs.map(i => i.type).join(', ')})
                    </option>
                  ))}
                </select>

                {selectedFunction && (
                  <>
                    <input
                      type="text"
                      value={functionParams}
                      onChange={(e) => setFunctionParams(e.target.value)}
                      placeholder="Function parameters (comma-separated)"
                    />
                    <input
                      type="text"
                      value={callValue}
                      onChange={(e) => setCallValue(e.target.value)}
                      placeholder="ETH value (optional)"
                    />
                  </>
                )}
              </>
            )}

            {error && <div className="error">{error}</div>}
            <button onClick={handleAddCall}>Add to Batch</button>
          </div>

          {batchCalls.length > 0 && (
            <div className="batch-calls">
              <h4>Batch Calls ({batchCalls.length})</h4>
              {batchCalls.map((call, index) => (
                <div key={index} className="batch-call-item">
                  <div>
                    <strong>{call.contractName}</strong>
                    <p>{call.functionName}({call.params?.join(', ') || ''})</p>
                    <p className="address">{call.target}</p>
                  </div>
                  <button onClick={() => removeBatchCall(index)}>Remove</button>
                </div>
              ))}
              <div className="batch-actions">
                <button onClick={clearBatchCalls}>Clear All</button>
                <button onClick={handleBuildBatch}>Build Batch Data</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
