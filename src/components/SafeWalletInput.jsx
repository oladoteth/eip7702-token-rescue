import { useState } from 'react';
import { ethers } from 'ethers';
import { useApp } from '../contexts/AppContext';
import { useInjectedWallets, requestAccount, sendFromInjected } from '../utils/injectedWallets';

const SOURCE_LABELS = {
  connected: 'Connected wallet',
  generated: 'Generated in this app',
  imported: 'Imported by private key',
  rescue: 'Same as the rescue wallet'
};

function downloadSecret(wallet) {
  const text = [
    'Token Rescue Tool: safe wallet',
    `Address: ${wallet.address}`,
    `Private key: ${wallet.privateKey}`,
    wallet.mnemonic ? `Recovery phrase: ${wallet.mnemonic.phrase}` : '',
    '',
    'Anyone with this file controls the wallet. Store it offline.'
  ].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `safe-wallet-${wallet.address}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

export function SafeWalletInput() {
  const {
    safeWallet,
    setSafeWallet,
    rescueWallet,
    compromisedWallet,
    provider,
    currentChain,
    refreshBalances,
    batchCalls,
    clearBatchCalls
  } = useApp();
  const injectedWallets = useInjectedWallets();

  const [importKey, setImportKey] = useState('');
  const [generated, setGenerated] = useState(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [error, setError] = useState(null);

  const [fundAmount, setFundAmount] = useState('0.01');
  const [funding, setFunding] = useState(false);
  const [fundStatus, setFundStatus] = useState(null);
  const [fundError, setFundError] = useState(null);

  // Sending rescued assets back to the compromised address would hand them to the attacker.
  const applySafeWallet = (next) => {
    if (compromisedWallet && next.address.toLowerCase() === compromisedWallet.address.toLowerCase()) {
      setError('The safe wallet cannot be the compromised wallet.');
      return;
    }
    setError(null);
    setSafeWallet(next);
    setGenerated(null);
    setSavedConfirmed(false);
    setImportKey('');
  };

  const handleConnect = async ({ info, provider: eip1193 }) => {
    setError(null);
    try {
      const address = await requestAccount(eip1193);
      applySafeWallet({ address, source: 'connected', eip1193, walletName: info.name });
    } catch (err) {
      setError(err.code === 4001 ? 'Connection request was rejected.' : err.message);
    }
  };

  const handleImport = (e) => {
    e.preventDefault();
    try {
      const wallet = new ethers.Wallet(importKey.trim());
      applySafeWallet({ address: wallet.address, source: 'imported', privateKey: wallet.privateKey });
    } catch {
      setError('Invalid private key format');
    }
  };

  const handleFund = async () => {
    setFundError(null);
    setFundStatus(null);
    let value;
    try {
      value = ethers.parseEther(fundAmount.trim());
    } catch {
      setFundError('Enter a valid amount');
      return;
    }
    if (value <= 0n) {
      setFundError('Enter an amount above zero');
      return;
    }
    setFunding(true);
    try {
      const tx = safeWallet.source === 'connected'
        ? await sendFromInjected(safeWallet.eip1193, currentChain.chainId, rescueWallet.address, value)
        : await new ethers.Wallet(safeWallet.privateKey, provider).sendTransaction({ to: rescueWallet.address, value });
      setFundStatus(`Funding sent: ${tx.hash}. Waiting for confirmation...`);
      await tx.wait();
      setFundStatus(`Rescue wallet funded with ${fundAmount} ${currentChain.nativeCurrency.symbol}.`);
      refreshBalances();
    } catch (err) {
      setFundError(err.code === 'ACTION_REJECTED' ? 'Transaction was rejected in the wallet.' : (err.shortMessage || err.message));
    } finally {
      setFunding(false);
    }
  };

  if (safeWallet) {
    const canFund = safeWallet.source === 'connected' || safeWallet.source === 'imported';
    return (
      <div className="rescue-wallet-set">
        <h3>Safe Wallet (Destination)</h3>
        <div className="info">
          <p><strong>Address:</strong> <code>{safeWallet.address}</code></p>
          <p>
            <strong>Source:</strong> {SOURCE_LABELS[safeWallet.source]}
            {safeWallet.walletName ? ` (${safeWallet.walletName})` : ''}
          </p>
          <p className="description">Every rescued asset is sent to this address.</p>

          {canFund && (
            <div className="option-card">
              <h4>Fund the Rescue Wallet</h4>
              <p>
                Send {currentChain?.nativeCurrency?.symbol} from this safe wallet to the rescue wallet so it can pay gas.
                This is a normal transfer, so any wallet can sign it.
              </p>
              <div className="input-group">
                <input
                  type="text"
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  placeholder={`Amount in ${currentChain?.nativeCurrency?.symbol}`}
                />
              </div>
              <button onClick={handleFund} disabled={funding}>
                {funding ? 'Sending...' : 'Send to Rescue Wallet'}
              </button>
              {fundStatus && <div className="status">{fundStatus}</div>}
              {fundError && <div className="error">{fundError}</div>}
            </div>
          )}

          <button
            onClick={() => {
              // Batch calls have the destination encoded in their calldata.
              if (batchCalls.length > 0 && !window.confirm('Changing the safe wallet clears the current batch. Continue?')) {
                return;
              }
              clearBatchCalls();
              setSafeWallet(null);
            }}
            className="clear-btn"
          >
            Change Safe Wallet
          </button>
        </div>
      </div>
    );
  }

  if (generated) {
    return (
      <div className="rescue-wallet-input">
        <h3>Save Your New Safe Wallet</h3>
        <div className="warning-box">
          <p>
            <strong>⚠️ Critical:</strong> This is the only time the key is shown. Rescued assets go to this
            wallet, so if you lose the key you lose the assets.
          </p>
          <div className="private-key-display">
            <p><strong>Address:</strong> <code>{generated.address}</code></p>
            <p><strong>Private Key:</strong></p>
            <code className="private-key-value">{generated.privateKey}</code>
            <p><strong>Recovery Phrase:</strong></p>
            <code className="private-key-value">{generated.mnemonic?.phrase}</code>
            <button type="button" onClick={() => downloadSecret(generated)} className="copy-key-btn">
              Download Backup File
            </button>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(generated.privateKey)}
              className="copy-key-btn"
            >
              Copy Private Key
            </button>
          </div>
          <label>
            <input
              type="checkbox"
              checked={savedConfirmed}
              onChange={(e) => setSavedConfirmed(e.target.checked)}
            />{' '}
            I have saved the private key or recovery phrase somewhere safe.
          </label>
        </div>
        {error && <div className="error">{error}</div>}
        <button
          onClick={() => applySafeWallet({ address: generated.address, source: 'generated', privateKey: generated.privateKey })}
          disabled={!savedConfirmed}
        >
          Use This Safe Wallet
        </button>
        <button onClick={() => setGenerated(null)} className="clear-btn">Cancel</button>
      </div>
    );
  }

  return (
    <div className="rescue-wallet-input">
      <h3>Set Up Safe Wallet</h3>
      <p className="description">
        Rescued assets are sent here. Use a wallet the attacker has never had access to.
      </p>

      <div className="wallet-options">
        <div className="option-card">
          <h4>Connect Wallet</h4>
          <p>Use a browser wallet you already trust. Only its address is read.</p>
          {injectedWallets.length === 0 && <p className="hint">No browser wallet detected.</p>}
          {injectedWallets.map((w) => (
            <button key={w.info.uuid} onClick={() => handleConnect(w)} className="generate-btn">
              {w.info.icon && <img src={w.info.icon} alt="" width="16" height="16" />} {w.info.name}
            </button>
          ))}
        </div>

        <div className="option-card">
          <h4>Generate New Wallet</h4>
          <p>Create a fresh wallet. You must save its key before continuing.</p>
          <button onClick={() => setGenerated(ethers.Wallet.createRandom())} className="generate-btn">
            Generate Safe Wallet
          </button>
        </div>

        <div className="option-card">
          <h4>Import Wallet</h4>
          <p>Use a private key you control. You can also fund the rescue wallet from it.</p>
          <form onSubmit={handleImport}>
            <div className="input-group">
              <input
                type="password"
                value={importKey}
                onChange={(e) => setImportKey(e.target.value)}
                placeholder="0x..."
                className="private-key-input"
              />
            </div>
            <button type="submit" disabled={!importKey.trim()} className="import-btn">
              Import Safe Wallet
            </button>
          </form>
        </div>

        <div className="option-card">
          <h4>Use Rescue Wallet</h4>
          <p>Send assets to the rescue wallet that pays gas. Simplest, but keep its key safe.</p>
          <button
            onClick={() => applySafeWallet({ address: rescueWallet.address, source: 'rescue' })}
            className="import-btn"
          >
            Use {rescueWallet?.address.slice(0, 8)}...
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
    </div>
  );
}
