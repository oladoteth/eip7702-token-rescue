import { useState } from 'react';
import { ethers } from 'ethers';
import { useApp } from '../contexts/AppContext';
import { canDiscover } from '../discovery/index.js';
import { discoverApprovals, checkApproval, PERMIT2 } from '../discovery/approvals.js';
import { revokeCalls, revokeKey } from '../utils/rescueTx';
import { coveredKeys } from '../utils/batchKeys';

const KIND_LABELS = {
  erc20: 'Token allowance',
  operator: 'NFT operator (all items)',
  permit2: 'Permit2 allowance'
};

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatAmount(approval) {
  if (approval.kind === 'operator') return 'All items';
  // uint256 max for ERC-20, uint160 max for Permit2.
  if (approval.amount >= 2n ** 159n) return 'Unlimited';
  return approval.amount.toString();
}

export function ApprovalScanner() {
  const { currentChain, provider, compromisedWallet, batchCalls, addBatchCall } = useApp();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [manualToken, setManualToken] = useState('');
  const [manualSpender, setManualSpender] = useState('');
  const [manualStatus, setManualStatus] = useState(null);

  const covered = coveredKeys(batchCalls);
  const inBatch = (approval) => covered.has(revokeKey(approval));

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const scan = await discoverApprovals({ network: currentChain, address: compromisedWallet.address, provider });
      setResult(scan);
      // A compromised wallet's approvals should all go, so every one starts selected.
      setSelected(new Set(scan.approvals.filter((a) => !inBatch(a)).map(revokeKey)));
    } catch (err) {
      setError(`Approval scan failed: ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  const handleAdd = (approvals) => {
    for (const call of revokeCalls(approvals.filter((a) => !inBatch(a)), PERMIT2)) {
      addBatchCall(call);
    }
  };

  const handleManualCheck = async (e) => {
    e.preventDefault();
    setManualStatus(null);
    if (!ethers.isAddress(manualToken.trim()) || !ethers.isAddress(manualSpender.trim())) {
      setManualStatus({ error: 'Enter a valid token (or collection) address and spender address.' });
      return;
    }
    try {
      const found = await checkApproval(provider, compromisedWallet.address, ethers.getAddress(manualToken.trim()), ethers.getAddress(manualSpender.trim()));
      if (found.length === 0) {
        setManualStatus({ error: 'No active approval found for that pair.' });
        return;
      }
      handleAdd(found);
      setManualStatus({ ok: `Added ${found.length} revoke${found.length > 1 ? 's' : ''} to the batch.` });
      setManualToken('');
      setManualSpender('');
    } catch (err) {
      setManualStatus({ error: err.shortMessage || err.message });
    }
  };

  const addable = result ? result.approvals.filter((a) => selected.has(revokeKey(a)) && !inBatch(a)) : [];

  return (
    <div className="approval-scanner">
      <h3>Revoke Approvals</h3>
      <p className="description">
        Approvals let another address move this wallet's tokens. Revoking them stops the attacker from pulling
        tokens that arrive after the rescue. Revokes run first in the batch.
      </p>

      {canDiscover(currentChain) ? (
        <>
          <button onClick={handleScan} disabled={scanning}>
            {scanning ? 'Scanning approvals...' : result ? 'Scan Approvals Again' : 'Scan Approvals'}
          </button>
          {error && <div className="error">{error}</div>}
          {result && (
            <div className="scan-results">
              {result.truncated && (
                <p className="hint">This wallet has more approval events than one scan reads. Add any missing ones below.</p>
              )}
              {result.approvals.length === 0 && <p>No active approvals found.</p>}
              {result.approvals.length > 0 && (
                <table className="scan-table">
                  <tbody>
                    {result.approvals.map((approval) => {
                      const key = revokeKey(approval);
                      return (
                        <tr key={key}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Revoke ${approval.symbol ?? approval.token} for ${approval.spender}`}
                              checked={inBatch(approval) || selected.has(key)}
                              disabled={inBatch(approval)}
                              onChange={() =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  return next;
                                })
                              }
                            />
                          </td>
                          <td>
                            <strong title={approval.token}>{approval.symbol ?? shortAddress(approval.token)}</strong>
                            <div className="scan-name">{KIND_LABELS[approval.kind]}</div>
                          </td>
                          <td className="scan-amount">{inBatch(approval) ? 'In batch' : formatAmount(approval)}</td>
                          <td>
                            Spender <code title={approval.spender}>{shortAddress(approval.spender)}</code>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {result.approvals.length > 0 && (
                <button onClick={() => handleAdd(addable)} disabled={addable.length === 0}>
                  Add {addable.length} Revoke{addable.length === 1 ? '' : 's'} to Batch
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="hint">Automatic approval scanning is not available on {currentChain?.name}. Check a pair below.</p>
      )}

      <form onSubmit={handleManualCheck} className="manual-revoke">
        <p className="hint">Revoke a specific approval: the token or NFT collection, and the spender.</p>
        <div className="input-group">
          <input type="text" value={manualToken} onChange={(e) => setManualToken(e.target.value)} placeholder="Token or collection (0x...)" />
        </div>
        <div className="input-group">
          <input type="text" value={manualSpender} onChange={(e) => setManualSpender(e.target.value)} placeholder="Spender (0x...)" />
        </div>
        <button type="submit" disabled={!manualToken.trim() || !manualSpender.trim()}>Check and Add Revoke</button>
        {manualStatus?.error && <div className="error">{manualStatus.error}</div>}
        {manualStatus?.ok && <div className="status">{manualStatus.ok}</div>}
      </form>
    </div>
  );
}
