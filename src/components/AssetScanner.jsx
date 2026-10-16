import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { useApp } from '../contexts/AppContext';
import { canDiscover, discoverErc20, discoverNfts } from '../discovery/index.js';
import { nftKey } from '../discovery/balances.js';
import { erc20TransferCall, nftTransferCalls } from '../utils/rescueTx';

const TOKEN_GROUPS = [
  { category: 'valuable', title: 'Worth rescuing', open: true },
  { category: 'dust', title: 'Low value (under $1)', open: false },
  { category: 'unpriced', title: 'No market price (possibly spam)', open: false },
  { category: 'spam', title: 'Likely scam tokens', open: false }
];

const NFT_GROUPS = [
  { category: 'nft', title: 'NFTs', open: true },
  { category: 'spam', title: 'Likely scam NFTs', open: false }
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

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function toggleIn(set, key) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function AssetScanner() {
  const { currentChain, provider, compromisedWallet, safeWallet, batchCalls, addBatchCall } = useApp();
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({});
  const [tokenScan, setTokenScan] = useState(null);
  const [nftScan, setNftScan] = useState(null);
  const [errors, setErrors] = useState({});
  const [selectedTokens, setSelectedTokens] = useState(new Set());
  const [selectedNfts, setSelectedNfts] = useState(new Set());
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const tokenInBatch = (asset) =>
    batchCalls.some((call) => call.source === 'erc20' && call.target.toLowerCase() === asset.token.toLowerCase());
  const nftInBatch = (asset) => {
    const key = nftKey(asset.token, asset.tokenId);
    return batchCalls.some((call) => call.nftKeys?.includes(key));
  };

  const handleScan = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setErrors({});
    setTokenScan(null);
    setNftScan(null);
    const params = { network: currentChain, address: compromisedWallet.address, provider, signal: controller.signal };

    // Independent scans: a slow or failing NFT listing must not hide token results.
    const [tokens, nfts] = await Promise.allSettled([
      discoverErc20({ ...params, onProgress: (stage) => setProgress((p) => ({ ...p, tokens: stage })) }),
      discoverNfts({ ...params, onProgress: (stage) => setProgress((p) => ({ ...p, nfts: stage })) })
    ]);
    if (controller.signal.aborted) return;

    const nextErrors = {};
    if (tokens.status === 'fulfilled') {
      setTokenScan(tokens.value);
      setSelectedTokens(new Set(tokens.value.assets.filter((a) => a.category === 'valuable' && !tokenInBatch(a)).map((a) => a.token)));
    } else {
      nextErrors.tokens = `Token scan failed: ${tokens.reason.message}`;
    }
    if (nfts.status === 'fulfilled') {
      setNftScan(nfts.value);
      setSelectedNfts(new Set());
    } else {
      nextErrors.nfts = `NFT scan failed: ${nfts.reason.message}`;
    }
    setErrors(nextErrors);
    setScanning(false);
    setProgress({});
  };

  const handleAdd = () => {
    for (const asset of tokenScan?.assets ?? []) {
      if (!selectedTokens.has(asset.token) || tokenInBatch(asset)) continue;
      addBatchCall(erc20TransferCall({
        token: asset.token,
        to: safeWallet.address,
        amount: asset.balance,
        symbol: asset.symbol || 'TOKEN',
        decimals: asset.decimals
      }));
    }
    const nfts = (nftScan?.assets ?? []).filter((a) => selectedNfts.has(nftKey(a.token, a.tokenId)) && !nftInBatch(a));
    for (const call of nftTransferCalls(nfts, compromisedWallet.address, safeWallet.address)) {
      addBatchCall(call);
    }
    setSelectedTokens(new Set());
    setSelectedNfts(new Set());
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

  const tokenCount = (tokenScan?.assets ?? []).filter((a) => selectedTokens.has(a.token) && !tokenInBatch(a)).length;
  const nftCount = (nftScan?.assets ?? []).filter((a) => selectedNfts.has(nftKey(a.token, a.tokenId)) && !nftInBatch(a)).length;
  const addable = tokenCount + nftCount;
  const hasResults = tokenScan || nftScan;

  return (
    <div className="asset-scanner">
      <h3>Scan Compromised Wallet</h3>
      <p className="description">
        Finds the tokens and NFTs this wallet holds and checks every one on-chain. Only the wallet address is
        sent to Blockscout and DefiLlama, never a key.
      </p>
      <button onClick={handleScan} disabled={scanning}>
        {scanning ? 'Scanning...' : hasResults ? 'Scan Again' : 'Scan Wallet'}
      </button>
      {progress.tokens && <div className="status">{progress.tokens}</div>}
      {progress.nfts && <div className="status">{progress.nfts}</div>}
      {errors.tokens && <div className="error">{errors.tokens} You can retry, or add tokens manually below.</div>}
      {errors.nfts && <div className="error">{errors.nfts} You can retry.</div>}

      {tokenScan && (
        <div className="scan-results">
          <h4>Tokens</h4>
          {tokenScan.assets.length === 0 && <p>No tokens with an on-chain balance were found.</p>}
          {tokenScan.skippedUnpriced && (
            <p className="hint">
              Stopped listing at tokens with no market price. If a token you expect is missing, add it manually below.
            </p>
          )}
          {tokenScan.truncated && (
            <p className="hint">This wallet holds more tokens than one scan lists. Add any missing ones manually.</p>
          )}
          {tokenScan.pricesUnavailable && (
            <p className="hint">DefiLlama prices were unavailable, so some tokens show no value.</p>
          )}
          {tokenScan.assets.length > 0 && (
            <p className="hint">
              Values use market prices. Airdropped tokens with little trading can show a large value that cannot
              really be sold.
            </p>
          )}
          {TOKEN_GROUPS.map(({ category, title, open }) => {
            const assets = tokenScan.assets.filter((a) => a.category === category);
            if (assets.length === 0) return null;
            return (
              <details key={category} open={open} className={`scan-group scan-${category}`}>
                <summary>{title} ({assets.length})</summary>
                <table className="scan-table">
                  <tbody>
                    {assets.map((asset) => (
                      <tr key={asset.token}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${asset.symbol}`}
                            checked={tokenInBatch(asset) || selectedTokens.has(asset.token)}
                            disabled={tokenInBatch(asset)}
                            onChange={() => setSelectedTokens((prev) => toggleIn(prev, asset.token))}
                          />
                        </td>
                        <td>
                          <strong>{asset.symbol || '?'}</strong>
                          <div className="scan-name">{asset.name}</div>
                        </td>
                        <td className="scan-amount">{formatAmount(asset)}</td>
                        <td className="scan-amount">{tokenInBatch(asset) ? 'In batch' : formatUsd(asset.valueUsd)}</td>
                        <td><code title={asset.token}>{shortAddress(asset.token)}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            );
          })}
        </div>
      )}

      {nftScan && (
        <div className="scan-results">
          <h4>NFTs</h4>
          {nftScan.assets.length === 0 && <p>No NFTs held on-chain were found.</p>}
          {nftScan.truncated && (
            <p className="hint">This wallet holds more NFTs than one scan lists. Rescue these first, then scan again.</p>
          )}
          {nftScan.assets.length > 0 && (
            <p className="hint">
              NFTs have no reliable price, so none are pre-selected. Scam collections often copy famous names:
              check the contract before rescuing one you do not recognize.
            </p>
          )}
          {NFT_GROUPS.map(({ category, title, open }) => {
            const assets = nftScan.assets.filter((a) => a.category === category);
            if (assets.length === 0) return null;
            const selectable = assets.filter((a) => !nftInBatch(a)).map((a) => nftKey(a.token, a.tokenId));
            return (
              <details key={category} open={open} className={`scan-group scan-${category === 'spam' ? 'spam' : 'valuable'}`}>
                <summary>{title} ({assets.length})</summary>
                <button
                  className="scan-select-all"
                  onClick={() => setSelectedNfts((prev) => new Set([...prev, ...selectable]))}
                  disabled={selectable.length === 0}
                >
                  Select all {selectable.length}
                </button>
                <table className="scan-table">
                  <tbody>
                    {assets.map((asset) => {
                      const key = nftKey(asset.token, asset.tokenId);
                      return (
                        <tr key={key}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${asset.name} #${asset.tokenId}`}
                              checked={nftInBatch(asset) || selectedNfts.has(key)}
                              disabled={nftInBatch(asset)}
                              onChange={() => setSelectedNfts((prev) => toggleIn(prev, key))}
                            />
                          </td>
                          <td>
                            <strong>{asset.name || 'Unnamed collection'}</strong>
                            <div className="scan-name">{asset.type}</div>
                          </td>
                          <td className="scan-amount" title={asset.tokenId.toString()}>
                            #{asset.tokenId.toString().length > 12 ? `${asset.tokenId.toString().slice(0, 10)}...` : asset.tokenId.toString()}
                            {asset.type === 'ERC-1155' && ` x${asset.amount}`}
                          </td>
                          <td className="scan-amount">{nftInBatch(asset) ? 'In batch' : ''}</td>
                          <td><code title={asset.token}>{shortAddress(asset.token)}</code></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </details>
            );
          })}
        </div>
      )}

      {hasResults && (
        <button onClick={handleAdd} disabled={addable === 0}>
          Add {addable} Selected Asset{addable === 1 ? '' : 's'} to Batch
        </button>
      )}
    </div>
  );
}
