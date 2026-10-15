import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { parseABI } from '../utils/contracts';

export function ContractLoader() {
  const { contracts, addContract, removeContract } = useApp();
  const [contractAddress, setContractAddress] = useState('');
  const [abiInput, setAbiInput] = useState('');
  const [contractName, setContractName] = useState('');
  const [error, setError] = useState(null);

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
      addContract({
        address: contractAddress.trim(),
        abi,
        name: contractName.trim() || `Contract ${contracts.length + 1}`
      });
      setContractAddress('');
      setAbiInput('');
      setContractName('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="contract-loader">
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
              </div>
              <button onClick={() => removeContract(index)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
