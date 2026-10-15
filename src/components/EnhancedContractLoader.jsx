import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { parseABI, getReadFunctions, getWriteFunctions, formatFunctionSignature } from '../utils/contractFunctions';
import { decodeTransactionWithContracts } from '../utils/transactionDecoder';
import { ethers } from 'ethers';

export function EnhancedContractLoader() {
  const { contracts, addContract, removeContract, provider, addBatchCall } = useApp();
  const [contractAddress, setContractAddress] = useState('');
  const [abiInput, setAbiInput] = useState('');
  const [contractName, setContractName] = useState('');
  const [error, setError] = useState(null);
  const [selectedContract, setSelectedContract] = useState(null);
  const [txDataInput, setTxDataInput] = useState('');
  const [decodedTx, setDecodedTx] = useState(null);

  const handleAdd = () => {
    setError(null);

    if (!contractAddress.trim()) {
      setError('Contract address is required');
      return;
    }

    if (!abiInput.trim()) {
      setError('ABI is required');
      return;
    }

    try {
      const abi = parseABI(abiInput);
      const readFunctions = getReadFunctions(abi);
      const writeFunctions = getWriteFunctions(abi);
      
      addContract({
        address: contractAddress.trim(),
        abi,
        name: contractName.trim() || `Contract ${contracts.length + 1}`,
        readFunctions,
        writeFunctions
      });
      setContractAddress('');
      setAbiInput('');
      setContractName('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSelectContract = (contract) => {
    setSelectedContract(contract);
    setDecodedTx(null);
    setTxDataInput('');
  };

  const handleDecodeTransaction = () => {
    setError(null);
    
    if (!txDataInput.trim()) {
      setError('Transaction data is required');
      return;
    }

    if (contracts.length === 0) {
      setError('No contracts loaded. Please load contracts first.');
      return;
    }

    try {
      const decoded = decodeTransactionWithContracts(txDataInput, contracts);
      setDecodedTx(decoded);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddDecodedToBatch = () => {
    if (!decodedTx) return;
    
    // Extract data from input
    let data = txDataInput.trim();
    
    // Try to extract from JSON
    if (data.includes('{')) {
      try {
        const json = JSON.parse(data);
        data = json.data || json.input || json.dataHex || data;
      } catch (e) {
        // Not valid JSON, try to extract hex
        const hexMatch = data.match(/0x[a-fA-F0-9]{8,}/);
        if (hexMatch) {
          data = hexMatch[0];
        }
      }
    }
    
    // Ensure it's a hex string
    if (!data.startsWith('0x')) {
      setError('Invalid transaction data format');
      return;
    }
    
    // Parse value
    let value = 0n;
    if (decodedTx.value) {
      try {
        value = typeof decodedTx.value === 'string' 
          ? ethers.parseEther(decodedTx.value === '0' ? '0' : decodedTx.value)
          : BigInt(decodedTx.value);
      } catch {
        value = 0n;
      }
    }
    
    addBatchCall({
      target: decodedTx.contractAddress,
      data: data,
      value: value,
      contractName: decodedTx.contractName,
      functionName: decodedTx.functionName,
      args: decodedTx.args
    });
    
    setDecodedTx(null);
    setTxDataInput('');
    setError(null);
  };

  return (
    <div className="enhanced-contract-loader">
      <h3>Load Contracts & ABIs</h3>
      
      <div className="contract-form">
        <input
          type="text"
          value={contractName}
          onChange={(e) => setContractName(e.target.value)}
          placeholder="Contract Name (optional)"
        />
        <input
          type="text"
          value={contractAddress}
          onChange={(e) => setContractAddress(e.target.value)}
          placeholder="Contract Address (0x...)"
        />
        <textarea
          value={abiInput}
          onChange={(e) => setAbiInput(e.target.value)}
          placeholder="Paste ABI JSON here..."
          rows="10"
          className="abi-input"
        />
        {error && <div className="error">{error}</div>}
        <button onClick={handleAdd}>Add Contract</button>
      </div>

      {contracts.length > 0 && (
        <div className="contracts-list">
          <h4>Loaded Contracts ({contracts.length})</h4>
          {contracts.map((contract, index) => (
            <div key={index} className="contract-item">
              <div>
                <strong>{contract.name}</strong>
                <p className="address">{contract.address}</p>
                <div className="function-counts">
                  <span>Read: {contract.readFunctions?.length || 0}</span>
                  <span>Write: {contract.writeFunctions?.length || 0}</span>
                </div>
              </div>
              <div>
                <button onClick={() => handleSelectContract(contract)}>View Functions</button>
                <button onClick={() => removeContract(index)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedContract && (
        <div className="contract-functions">
          <h4>Functions for {selectedContract.name}</h4>
          <button onClick={() => setSelectedContract(null)}>Close</button>
          
          {selectedContract.readFunctions && selectedContract.readFunctions.length > 0 && (
            <div className="read-functions">
              <h5>Read Functions</h5>
              {selectedContract.readFunctions.map((func, idx) => (
                <div key={idx} className="function-item">
                  <code>{formatFunctionSignature(func)}</code>
                </div>
              ))}
            </div>
          )}

          {selectedContract.writeFunctions && selectedContract.writeFunctions.length > 0 && (
            <div className="write-functions">
              <h5>Write Functions</h5>
              {selectedContract.writeFunctions.map((func, idx) => (
                <div key={idx} className="function-item">
                  <code>{formatFunctionSignature(func)}</code>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="transaction-decoder">
        <h4>Decode Transaction Data</h4>
        <p>Paste transaction data (hex or JSON) to decode and add to batch</p>
        <textarea
          value={txDataInput}
          onChange={(e) => setTxDataInput(e.target.value)}
          placeholder="Paste transaction data here (hex string or JSON)..."
          rows="5"
          className="tx-data-input"
        />
        <button onClick={handleDecodeTransaction}>Decode Transaction</button>
        
        {decodedTx && (
          <div className="decoded-transaction">
            <h5>Decoded Transaction</h5>
            <div className="decoded-info">
              <p><strong>Contract:</strong> {decodedTx.contractName}</p>
              <p><strong>Function:</strong> {decodedTx.functionName}</p>
              <p><strong>Arguments:</strong></p>
              <ul>
                {decodedTx.args.map((arg, idx) => (
                  <li key={idx}>{arg}</li>
                ))}
              </ul>
            </div>
            <button onClick={handleAddDecodedToBatch}>Add to Batch</button>
          </div>
        )}
      </div>
    </div>
  );
}
