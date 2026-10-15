import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { useApp } from '../contexts/AppContext';
import { canDiscover, discoverErc20 } from '../discovery/index.js';
import { erc20TransferCall } from '../utils/rescueTx';

const GROUPS = [
  { category: 'valuable', title: 'Worth rescuing', open: true },
  { category: 'dust', title: 'Low value (under $1)', open: false },
  { category: 'unpriced', title: 'No market price (possibly spam)', open: false },
  { category: 'spam', title: 'Likely scam tokens', open: false }
];

function formatAmount(asset) {
  if (asset.decimals == null) return asset.balance.toString();
  const amount = Number(ethers.formatUnits(asset.balance, asset.decimals));
  return amount.toLocaleString(undefined, { maximumSignificantDigits: 6 });
}

function formatUsd(value) {
  if (value == null) return '-';
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 4 : 2 });
}

export function AssetScanner() {
  const { currentChain, provider, compromisedWallet, safeWallet, batchCalls, addBatchCall } = useApp();
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const inBatch = (asset) =>
    batchCalls.some((call) => call.source === 'erc20' && call.target.toLowerCase() === asset.token.toLowerCase());

  const handleScan = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const scan = await discoverErc20({
        network: currentChain,
        address: compromisedWallet.address,
        provider,
        onProgress: setProgress,
        signal: controller.signal
      });
      setResult(scan);
      setSelected(new Set(scan.assets.filter((a) => a.category === 'valuable' && !inBatch(a)).map((a) => a.token)));
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(`Scan failed: ${err.message}. You can retry, or add tokens manually below.`);
      }
    } finally {
      setScanning(false);
      setProgress(null);
    }
  };

  const toggle = (token) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  };

  const handleAdd = () => {
    for (const asset of result.assets) {
      if (!selected.has(asset.token) || inBatch(asset)) continue;
      addBatchCall(
        erc20TransferCall({
          token: asset.token,
          to: safeWallet.address,
          amount: asset.balance,
          symbol: asset.symbol || 'TOKEN',
          decimals: asset.decimals
        })
      );
    }
    setSelected(new Set());
  };

  if (!canDiscover(currentChain)) {
    return (
      <div className="asset-scanner">
        <h3>Scan Compromised Wallet</h3>
        <p className="hint">
          Automatic scanning is not available on {currentChain?.name} yet. Add tokens manually below.
        </p>
      </div>
    );
  }

  const addable = result ? result.assets.filter((a) => selected.has(a.token) && !inBatch(a)).length : 0;

  return (
    <div className="asset-scanner">
      <h3>Scan Compromised Wallet</h3>
      <p className="description">
        Finds the tokens this wallet holds and checks every balance on-chain. Only the wallet address is
        sent to Blockscout and DefiLlama, never a key.
      </p>
      <button onClick={handleScan} disabled={scanning}>
        {scanning ? 'Scanning...' : result ? 'Scan Again' : 'Scan for Tokens'}
      </button>
      {progress && <div className="status">{progress}</div>}
      {error && <div className="error">{error}</div>}

      {result && (
        <div className="scan-results">
          {result.assets.length === 0 && <p>No tokens with an on-chain balance were found.</p>}
          {result.skippedUnpriced && (
            <p className="hint">
              Stopped listing at tokens with no market price. If a token you expect is missing, add it manually below.
            </p>
          )}
          {result.truncated && (
            <p className="hint">This wallet holds more tokens than one scan lists. Add any missing ones manually.</p>
          )}
          {result.pricesUnavailable && (
            <p className="hint">DefiLlama prices were unavailable, so some tokens show no value.</p>
          )}
          {result.assets.length > 0 && (
            <p className="hint">
              Values use market prices. Airdropped tokens with little trading can show a large value that cannot
              really be sold.
            </p>
          )}

          {GROUPS.map(({ category, title, open }) => {
            const assets = result.assets.filter((a) => a.category === category);
            if (assets.length === 0) return null;
            return (
              <details key={category} open={open} className={`scan-group scan-${category}`}>
                <summary>
                  {title} ({assets.length})
                </summary>
                <table className="scan-table">
                  <tbody>
                    {assets.map((asset) => (
                      <tr key={asset.token}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${asset.symbol}`}
                            checked={inBatch(asset) || selected.has(asset.token)}
                            disabled={inBatch(asset)}
                            onChange={() => toggle(asset.token)}
                          />
                        </td>
                        <td>
                          <strong>{asset.symbol || '?'}</strong>
                          <div className="scan-name">{asset.name}</div>
                        </td>
                        <td className="scan-amount">{formatAmount(asset)}</td>
                        <td className="scan-amount">{inBatch(asset) ? 'In batch' : formatUsd(asset.valueUsd)}</td>
                        <td>
                          <code title={asset.token}>{asset.token.slice(0, 6)}...{asset.token.slice(-4)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            );
          })}

          {result.assets.length > 0 && (
            <button onClick={handleAdd} disabled={addable === 0}>
              Add {addable} Selected Token{addable === 1 ? '' : 's'} to Batch
            </button>
          )}
        </div>
      )}
    </div>
  );
}
