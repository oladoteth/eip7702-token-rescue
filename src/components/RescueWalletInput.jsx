import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { ethers } from 'ethers';

export function RescueWalletInput() {
  const { rescueWallet, setRescueWallet, provider, currentChain, clearAllState } = useApp();
  const [privateKey, setPrivateKey] = useState('');
  const [error, setError] = useState(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);

  const generateNewWallet = () => {
    try {
      if (!provider) {
        setError('Provider not available. Please select a chain first.');
        return;
      }
      
      // Generate a new random wallet
      const newWallet = ethers.Wallet.createRandom().connect(provider);
      
      setRescueWallet({
        address: newWallet.address,
        privateKey: newWallet.privateKey,
        wallet: newWallet
      });
      
      setPrivateKey('');
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleImport = (e) => {
    e.preventDefault();
    setError(null);
    
    if (!privateKey.trim()) {
      setError('Please enter a private key');
      return;
    }

    try {
      if (!provider) {
        setError('Provider not available. Please select a chain first.');
        return;
      }
      
      // Import wallet from private key
      const wallet = new ethers.Wallet(privateKey.trim(), provider);
      
      setRescueWallet({
        address: wallet.address,
        privateKey: wallet.privateKey,
        wallet: wallet
      });
      
      setPrivateKey(''); // Clear for security
      setError(null);
    } catch (err) {
      setError(err.message || 'Invalid private key format');
    }
  };

  const handleClear = () => {
    // Clear ALL application state including localStorage
    // This ensures a complete fresh start
    clearAllState(true); // true = also clear rescueWallet
    setPrivateKey('');
    setError(null);
    setShowPrivateKey(false);
  };

  if (rescueWallet) {
    return (
      <div className="rescue-wallet-set">
        <h3>Rescue Wallet (Gas Payer)</h3>
        <div className="info">
          <p><strong>Address:</strong> <code>{rescueWallet.address}</code></p>
          <div className="warning-box">
            <p><strong>⚠️ Important:</strong> Save your private key securely! You'll need it to use this wallet again.</p>
            {!showPrivateKey ? (
              <button 
                type="button"
                onClick={() => setShowPrivateKey(true)}
                className="show-key-btn"
              >
                Show Private Key
              </button>
            ) : (
              <div className="private-key-display">
                <p><strong>Private Key:</strong></p>
                <code className="private-key-value">{rescueWallet.privateKey}</code>
                <button 
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(rescueWallet.privateKey);
                  }}
                  className="copy-key-btn"
                >
                  Copy Private Key
                </button>
                <button 
                  type="button"
                  onClick={() => setShowPrivateKey(false)}
                  className="hide-key-btn"
                >
                  Hide Private Key
                </button>
              </div>
            )}
          </div>
          <button onClick={handleClear} className="clear-btn">
            Clear & Start Over
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rescue-wallet-input">
      <h3>Setup Rescue Wallet</h3>
      <p className="description">
        This wallet will pay for all gas fees during the rescue operation. You can either generate a new wallet 
        or import an existing one using a private key.
      </p>
      
      <div className="wallet-options">
        <div className="option-card">
          <h4>Generate New Wallet</h4>
          <p>Create a new wallet with a randomly generated private key. Make sure to save the private key securely!</p>
          <button onClick={generateNewWallet} disabled={!provider || !currentChain} className="generate-btn">
            Generate New Wallet
          </button>
          {(!provider || !currentChain) && (
            <p className="hint">Please select a chain first</p>
          )}
        </div>

        <div className="option-card">
          <h4>Import Existing Wallet</h4>
          <p>Import a wallet using its private key. This wallet will be used to pay for gas fees.</p>
          <form onSubmit={handleImport}>
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
            <button type="submit" disabled={!provider || !currentChain} className="import-btn">
              Import Wallet
            </button>
            {(!provider || !currentChain) && (
              <p className="hint">Please select a chain first</p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

