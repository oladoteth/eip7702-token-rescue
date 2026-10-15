import { useState } from 'react';
import { ethers } from 'ethers';
import { useApp } from '../contexts/AppContext';
import { buildErc20SweepCall } from '../utils/rescueTx';

export function TokenSweepInput() {
  const { provider, compromisedWallet, safeWallet, addBatchCall } = useApp();
  const [tokenAddress, setTokenAddress] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  const destination = safeWallet?.address;

  const handleAdd = async (e) => {
    e.preventDefault();
    setError(null);
    const token = tokenAddress.trim();
    if (!ethers.isAddress(token)) {
      setError('Enter a valid token contract address');
      return;
    }
    setAdding(true);
    try {
      addBatchCall(await buildErc20SweepCall(provider, token, compromisedWallet.address, destination));
      setTokenAddress('');
    } catch (err) {
      setError(err.shortMessage || err.message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="token-sweep-input">
      <h3>Rescue an ERC-20 Token</h3>
      <p className="description">
        Adds a transfer of the full balance to <code>{destination}</code>.
      </p>
      <form onSubmit={handleAdd}>
        <div className="input-group">
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            placeholder="Token contract address (0x...)"
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={adding || !tokenAddress.trim()}>
          {adding ? 'Reading balance...' : 'Add Full Balance to Batch'}
        </button>
      </form>
    </div>
  );
}
