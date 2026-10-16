import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useApp } from '../contexts/AppContext';
import { nativeSweepCall } from '../utils/rescueTx';

export function NativeSweep() {
  const { provider, currentChain, compromisedWallet, safeWallet, batchCalls, addBatchCall } = useApp();
  const [balance, setBalance] = useState(null);
  const [error, setError] = useState(null);
  const symbol = currentChain?.nativeCurrency?.symbol || 'ETH';
  const inBatch = batchCalls.some((call) => call.source === 'native');

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setBalance(await provider.getBalance(compromisedWallet.address));
    } catch (err) {
      setError(err.shortMessage || err.message);
    }
  }, [provider, compromisedWallet?.address]);

  useEffect(() => {
    refresh();
  }, [refresh, batchCalls.length]);

  return (
    <div className="native-sweep">
      <h3>Rescue {symbol}</h3>
      <p className="description">
        Current balance: <strong>{balance == null ? '...' : `${ethers.formatEther(balance)} ${symbol}`}</strong>{' '}
        <button type="button" onClick={refresh} className="scan-select-all">Refresh</button>
      </p>
      <p className="hint">
        Sends the whole {symbol} balance as it is when the rescue runs, so {symbol} released by earlier calls
        (for example an unstake) is included. It always runs last in the batch.
      </p>
      {error && <div className="error">{error}</div>}
      <button
        onClick={() => addBatchCall(nativeSweepCall(compromisedWallet.address, safeWallet.address, symbol))}
        disabled={inBatch}
      >
        {inBatch ? `${symbol} sweep is in the batch` : `Add ${symbol} Sweep to Batch`}
      </button>
    </div>
  );
}
