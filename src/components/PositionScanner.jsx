import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { adaptersFor, scanPositions, buildPositionCalls } from '../positions/index.js';
import { coveredKeys } from '../utils/batchKeys';

export function PositionScanner() {
  const { currentChain, provider, compromisedWallet, safeWallet, batchCalls, addBatchCall } = useApp();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState({}); // position id -> action id, or absent

  const adapters = adaptersFor(currentChain);
  const covered = coveredKeys(batchCalls);
  // A position whose assets are already moved by a call in the batch cannot be added again.
  const inBatch = (position) => position.covers.length > 0 && position.covers.every((key) => covered.has(key));

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const scan = await scanPositions({ network: currentChain, provider, address: compromisedWallet.address });
      setResult(scan);
      setSelected(Object.fromEntries(scan.positions.filter((p) => !inBatch(p)).map((p) => [p.id, p.actions[0].id])));
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  const handleAdd = () => {
    try {
      for (const position of result.positions) {
        const actionId = selected[position.id];
        if (!actionId || inBatch(position)) continue;
        for (const call of buildPositionCalls(position, actionId, { from: compromisedWallet.address, to: safeWallet.address })) {
          addBatchCall(call);
        }
      }
      setSelected({});
    } catch (err) {
      setError(err.message);
    }
  };

  if (adapters.length === 0) {
    return (
      <div className="position-scanner">
        <h3>Staking and DeFi Positions</h3>
        <p className="hint">
          No protocol adapters cover {currentChain?.name} yet. Use custom calls below for staking or lending positions.
        </p>
      </div>
    );
  }

  const addable = result ? result.positions.filter((p) => selected[p.id] && !inBatch(p)).length : 0;

  return (
    <div className="position-scanner">
      <h3>Staking and DeFi Positions</h3>
      <p className="description">
        Reads {adapters.map((a) => a.name).join(', ')} positions straight from the chain and releases them to the
        safe wallet in the same transaction.
      </p>
      <button onClick={handleScan} disabled={scanning}>
        {scanning ? 'Scanning...' : result ? 'Scan Positions Again' : 'Scan Positions'}
      </button>
      {error && <div className="error">{error}</div>}

      {result && (
        <div className="scan-results">
          {result.errors.map((e) => (
            <div key={e.adapter} className="warning">{e.adapter} could not be read: {e.message}</div>
          ))}
          {result.positions.length === 0 && result.errors.length === 0 && <p>No positions found.</p>}

          {result.positions.map((position) => (
            <div key={position.id} className="scan-group scan-valuable position-card">
              <label className="position-title">
                <input
                  type="checkbox"
                  checked={inBatch(position) || Boolean(selected[position.id])}
                  disabled={inBatch(position)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = { ...prev };
                      if (e.target.checked) next[position.id] = position.actions[0].id;
                      else delete next[position.id];
                      return next;
                    })
                  }
                />{' '}
                <strong>{position.title}</strong>
                {inBatch(position) && <span className="hint"> (in batch)</span>}
              </label>
              {position.details.map((line) => (
                <div key={line} className="scan-name">{line}</div>
              ))}
              {position.warning && <div className="warning">{position.warning}</div>}
              {!inBatch(position) && position.actions.map((action) => (
                <label key={action.id} className="position-action">
                  <input
                    type="radio"
                    name={`action-${position.id}`}
                    checked={selected[position.id] === action.id}
                    disabled={!selected[position.id]}
                    onChange={() => setSelected((prev) => ({ ...prev, [position.id]: action.id }))}
                  />{' '}
                  {action.label}
                  <div className="scan-name">{action.description}</div>
                </label>
              ))}
            </div>
          ))}

          {result.positions.length > 0 && (
            <button onClick={handleAdd} disabled={addable === 0}>
              Add {addable} Selected Position{addable === 1 ? '' : 's'} to Batch
            </button>
          )}
        </div>
      )}
    </div>
  );
}
