import { useState } from 'react';
import { useApp } from '../contexts/AppContext';

export function CompromisedWalletInput() {
  const { compromisedWallet, setCompromisedWalletFromPrivateKey, setCompromisedWallet, provider } = useApp();
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
