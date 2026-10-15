import { useState } from 'react';
import { ethers } from 'ethers';
import { useApp } from '../contexts/AppContext';

export function CompromisedWalletInput() {
  const { compromisedWallet, setCompromisedWalletFromPrivateKey, setCompromisedWallet, provider, safeWallet, rescueWallet } = useApp();
  const [privateKey, setPrivateKey] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError(null);
    
    if (!privateKey.trim()) {
      setError('Please enter a private key');
      return;
    }

    try {
      if (!provider) {
        setError('Provider not initialized. Please select a chain first.');
        return;
      }
      // The attacker holds this key. Rescuing into it, or paying gas from it, defeats the rescue.
      const address = new ethers.Wallet(privateKey.trim()).address.toLowerCase();
      if (address === safeWallet?.address.toLowerCase()) {
        setError('This is the safe wallet. Enter the key of the compromised wallet instead.');
        return;
      }
      if (address === rescueWallet?.address.toLowerCase()) {
        setError('This is the rescue wallet. Enter the key of the compromised wallet instead.');
        return;
      }
      setCompromisedWalletFromPrivateKey(privateKey.trim());
      setPrivateKey(''); // Clear for security
    } catch (err) {
      setError(err.message);
    }
  };

  if (compromisedWallet) {
    return (
      <div className="compromised-wallet-set">
        <h3>Compromised Wallet</h3>
        <div className="info">
          <p><strong>Address:</strong> {compromisedWallet.address}</p>
          <button onClick={() => {
            setCompromisedWallet(null);
            setPrivateKey('');
          }}>
            Clear
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="compromised-wallet-input">
      <h3>Enter Compromised Wallet Private Key</h3>
      <p className="warning">
        ⚠️ Your private key is processed locally and never sent to any server.
        However, ensure you're in a secure environment.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <input
            type="password"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="0x..."
            className="private-key-input"
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button type="submit">Set Compromised Wallet</button>
      </form>
    </div>
  );
}
