import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { encodeFunctionCall } from '../utils/contracts';
import { getWriteFunctions, formatFunctionSignature, getFunctionParameterTypes } from '../utils/contractFunctions';
import { ethers } from 'ethers';

export function InteractiveBatchBuilder() {
  const { contracts, addBatchCall } = useApp();
  const [selectedContract, setSelectedContract] = useState('');
  const [selectedFunction, setSelectedFunction] = useState('');
  const [functionParams, setFunctionParams] = useState({});
  const [callValue, setCallValue] = useState('0');
  const [error, setError] = useState(null);

  const selectedContractData = contracts.find(c => c.address === selectedContract);

  const availableFunctions = selectedContractData
    ? getWriteFunctions(selectedContractData.abi)
    : [];

  const selectedFunctionData = availableFunctions.find(f => f.name === selectedFunction);

  const handleParamChange = (paramIndex, value) => {
    setFunctionParams(prev => ({
      ...prev,
      [paramIndex]: value
    }));
  };

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
      // Build parameters array
      const params = selectedFunctionData.inputs.map((input, idx) => {
        const value = functionParams[idx] || '';
        
        // Try to parse based on type
        if (input.type.startsWith('uint') || input.type.startsWith('int')) {
          return value ? BigInt(value) : 0n;
        } else if (input.type === 'bool') {
          return value === 'true' || value === true;
        } else if (input.type === 'address') {
          if (!ethers.isAddress(value)) {
            throw new Error(`Invalid address for parameter ${input.name}`);
          }
          return value;
        } else if (input.type.startsWith('bytes')) {
          if (!value.startsWith('0x')) {
            throw new Error(`Bytes parameter ${input.name} must start with 0x`);
          }
          return value;
        } else {
          return value;
        }
      });

      const data = encodeFunctionCall(selectedContractData.abi, selectedFunction, params);
      
      addBatchCall({
        target: selectedContract,
        data,
        value: ethers.parseEther(callValue || '0'),
        contractName: selectedContractData.name,
        functionName: selectedFunction,
        params: params.map(p => String(p))
      });

      // Reset form
      setSelectedFunction('');
      setFunctionParams({});
      setCallValue('0');
    } catch (err) {
      setError(err.message);
    }
  };

  if (contracts.length === 0) {
    return (
      <div className="batch-builder-empty">
        <p>Load contracts first to build batch transactions interactively.</p>
      </div>
    );
  }

  return (
    <div className="interactive-batch-builder">
      <h3>Build Batch Transactions</h3>

      <div className="builder-form">
        <select
          value={selectedContract}
          onChange={(e) => {
            setSelectedContract(e.target.value);
            setSelectedFunction('');
            setFunctionParams({});
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
          <select
            value={selectedFunction}
            onChange={(e) => {
              setSelectedFunction(e.target.value);
              setFunctionParams({});
            }}
          >
            <option value="">Select Function</option>
            {availableFunctions.map((func, index) => (
              <option key={index} value={func.name}>
                {formatFunctionSignature(func)}
              </option>
            ))}
          </select>
        )}

        {selectedFunctionData && (
          <div className="function-params">
            <h4>Function Parameters</h4>
            {selectedFunctionData.inputs.map((input, idx) => (
              <div key={idx} className="param-input">
                <label>
                  {input.name || `param${idx}`} ({input.type})
                </label>
                <input
                  type="text"
                  value={functionParams[idx] || ''}
                  onChange={(e) => handleParamChange(idx, e.target.value)}
                  placeholder={`Enter ${input.type}`}
                />
              </div>
            ))}
          </div>
        )}

        <div className="value-input">
          <label>ETH Value (optional)</label>
          <input
            type="text"
            value={callValue}
            onChange={(e) => setCallValue(e.target.value)}
            placeholder="0"
          />
        </div>

        {error && <div className="error">{error}</div>}
        <button onClick={handleAddCall} disabled={!selectedFunction}>
          Add to Batch
        </button>
      </div>
    </div>
  );
}
