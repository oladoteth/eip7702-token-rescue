import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { getWriteFunctions, functionSignature, buildCustomCall } from '../utils/contractFunctions';

function placeholderFor(type) {
  if (type.endsWith(']')) return 'JSON array, for example [1, 2]';
  if (type.startsWith('tuple')) return 'JSON array of the fields, in order';
  if (type === 'bool') return 'true or false';
  if (type === 'address') return '0x...';
  if (type.startsWith('bytes')) return '0x...';
  return type;
}

export function InteractiveBatchBuilder() {
  const { contracts, addBatchCall, currentChain } = useApp();
  const [selectedContract, setSelectedContract] = useState('');
  const [selectedSignature, setSelectedSignature] = useState('');
  const [functionParams, setFunctionParams] = useState({});
  const [callValue, setCallValue] = useState('0');
  const [error, setError] = useState(null);

  const selectedContractData = contracts.find((c) => c.address === selectedContract);
  const availableFunctions = selectedContractData ? getWriteFunctions(selectedContractData.abi) : [];
  // Overloads share a name, so functions are picked by their full signature.
  const selectedFunctionData = availableFunctions.find((f) => functionSignature(f) === selectedSignature);
  const symbol = currentChain?.nativeCurrency?.symbol || 'ETH';

  const handleAddCall = () => {
    setError(null);
    if (!selectedContractData) {
      setError('Please select a contract');
      return;
    }
    if (!selectedFunctionData) {
      setError('Please select a function');
      return;
    }
    try {
      const params = selectedFunctionData.inputs.map((_, idx) => functionParams[idx]);
      addBatchCall(buildCustomCall(selectedContractData, selectedSignature, params, callValue));
      setSelectedSignature('');
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
            setSelectedSignature('');
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
            value={selectedSignature}
            onChange={(e) => {
              setSelectedSignature(e.target.value);
              setFunctionParams({});
            }}
          >
            <option value="">Select Function</option>
            {availableFunctions.map((func) => {
              const signature = functionSignature(func);
              return (
                <option key={signature} value={signature}>
                  {signature}{func.stateMutability === 'payable' ? ' (payable)' : ''}
                </option>
              );
            })}
          </select>
        )}

        {selectedFunctionData && (
          <div className="function-params">
            <h4>Function Parameters</h4>
            {selectedFunctionData.inputs.length === 0 && <p className="hint">This function takes no parameters.</p>}
            {selectedFunctionData.inputs.map((input, idx) => (
              <div key={idx} className="param-input">
                <label>
                  {input.name || `param${idx}`} ({input.type})
                </label>
                <input
                  type="text"
                  value={functionParams[idx] || ''}
                  onChange={(e) => setFunctionParams((prev) => ({ ...prev, [idx]: e.target.value }))}
                  placeholder={placeholderFor(input.type)}
                />
              </div>
            ))}
          </div>
        )}

        {selectedFunctionData?.stateMutability === 'payable' && (
          <div className="value-input">
            <label>{symbol} to send with the call (from the compromised wallet)</label>
            <input
              type="text"
              value={callValue}
              onChange={(e) => setCallValue(e.target.value)}
              placeholder="0"
            />
          </div>
        )}

        {error && <div className="error">{error}</div>}
        <button onClick={handleAddCall} disabled={!selectedFunctionData}>
          Add to Batch
        </button>
      </div>
    </div>
  );
}
