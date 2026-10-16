/**
 * Chain Selector Component
 * Works with RPC providers - no wallet connection required
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../contexts/AppContext';
import { getAllNetworks } from '../utils/networks';
import { ethers } from 'ethers';

export function ChainSelector() {
  const { 
    rescueWallet, 
    currentChain, 
    selectedChainId, 
    setSelectedChainId, 
    provider,
    balanceRefreshKey,
    rpcStatus,
    customRpc,
    setCustomRpc
  } = useApp();
  const [rpcInput, setRpcInput] = useState('');
  const [rpcChecking, setRpcChecking] = useState(false);
  const [rpcError, setRpcError] = useState(null);

  // Session-only: the URL may contain an API key, so it is never written to storage.
  const handleUseRpc = async (e) => {
    e.preventDefault();
    setRpcError(null);
    let url;
    try {
      url = new URL(rpcInput.trim());
      if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        throw new Error('Use an https:// RPC URL');
      }
    } catch (err) {
      setRpcError(err.message.startsWith('Use') ? err.message : 'Enter a valid RPC URL');
      return;
    }
    setRpcChecking(true);
    const probe = new ethers.JsonRpcProvider(url.href, undefined, { cacheTimeout: -1, staticNetwork: true });
    try {
      const chainId = Number(await probe.send('eth_chainId', []));
      const known = networks.find((n) => n.chainId === chainId);
      setCustomRpc({
        url: url.href,
        chainId,
        network: known ? undefined : {
          chainId,
          name: `Chain ${chainId}`,
          rpcUrl: url.href,
          rpcUrls: [url.href],
          explorer: '',
          nativeCurrency: { name: 'Native coin', symbol: 'ETH', decimals: 18 },
          discovery: { blockscout: null, llama: null }
        }
      });
      handleChainChange(chainId);
      setRpcInput('');
    } catch (err) {
      setRpcError(`Could not reach that RPC: ${err.shortMessage || err.message}`);
    } finally {
      probe.destroy();
      setRpcChecking(false);
    }
  };
  
  const [balance, setBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);

  const networks = getAllNetworks();

  // Update selected chain in context when changed
  const handleChainChange = useCallback((targetChainId) => {
    if (targetChainId === selectedChainId) {
      return; // Already selected
    }

    console.log('[ChainSelector] Selecting chain:', targetChainId);
    setSelectedChainId(targetChainId);
    setBalance(null); // Clear balance when chain changes
    setError(null);
    setWarning(null);
  }, [selectedChainId, setSelectedChainId]);

  // Check balance for rescue wallet
  const checkBalance = useCallback(async () => {
    if (!rescueWallet?.address) {
      console.log('[ChainSelector] Cannot check balance: rescue wallet not set');
      return;
    }

    if (!provider) {
      console.log('[ChainSelector] Cannot check balance: provider not available');
      return;
    }

    console.log('[ChainSelector] Starting balance check for address:', rescueWallet.address);
    setBalanceLoading(true);
    setError(null);
    
    try {
      // Use direct provider balance check
      console.log('[ChainSelector] Fetching balance via provider.getBalance()...');
      const balance = await provider.getBalance(rescueWallet.address);
      const formatted = ethers.formatEther(balance);
      
      const balanceInfo = {
        balance,
        formatted,
        symbol: currentChain?.nativeCurrency?.symbol || 'ETH',
        hasBalance: balance > 0n
      };
      
      console.log('[ChainSelector] Balance fetched successfully:', balanceInfo);
      setBalance(balanceInfo);
      setBalanceLoading(false);
      
      if (!balanceInfo.hasBalance) {
        setWarning('⚠️ Your rescue wallet has zero balance. You need native tokens for gas fees.');
      } else {
        setWarning(null);
      }
    } catch (err) {
      console.error('[ChainSelector] Balance check error:', err);
      setError(err.message || 'Failed to fetch balance');
      setBalanceLoading(false);
    }
  }, [rescueWallet?.address, provider, currentChain]);

  // Check balance when rescue wallet is set and chain is selected
  useEffect(() => {
    if (!rescueWallet?.address || !selectedChainId || !provider) {
      setBalance(null);
      return;
    }

    // Small delay to ensure provider is ready
    const timer = setTimeout(() => {
      checkBalance();
    }, 500);

    return () => clearTimeout(timer);
  }, [rescueWallet?.address, selectedChainId, provider, checkBalance, balanceRefreshKey]);

  return (
    <div className="chain-selector">
      <h3>Select Chain</h3>
      <p>Choose the blockchain network for the rescue operation</p>

      <div className="chain-select">
        <select
          value={selectedChainId || ''}
          onChange={(e) => handleChainChange(Number(e.target.value))}
        >
          <option value="">Select Chain</option>
          {networks.map((network) => (
            <option key={network.chainId} value={network.chainId}>
              {network.name}{network.testnet ? ' (testnet)' : ''} (Chain ID: {network.chainId})
            </option>
          ))}
          {customRpc?.network && (
            <option value={customRpc.chainId}>
              {customRpc.network.name} (custom RPC)
            </option>
          )}
        </select>
      </div>

      {currentChain && (
        <div className="current-chain-info">
          <p><strong>Current Chain:</strong> {currentChain.name}</p>
          {!rpcStatus && <p className="hint">Checking RPC and EIP-7702 support...</p>}
          {rpcStatus?.error && <div className="error">No RPC for this chain responded. {rpcStatus.error}</div>}
          {rpcStatus?.eip7702?.supported && (
            <p className="hint">
              EIP-7702 supported. Checked live on {new URL(rpcStatus.url).host}
              {customRpc?.chainId === currentChain.chainId && rpcStatus.url === customRpc.url ? ' (your RPC)' : ''}.
            </p>
          )}
          {customRpc?.chainId === currentChain.chainId && rpcStatus?.url && rpcStatus.url !== customRpc.url && (
            <div className="warning">
              Your RPC ({new URL(customRpc.url).host}) was not used: it did not respond or does not simulate EIP-7702.
            </div>
          )}
          {rpcStatus?.eip7702 && !rpcStatus.eip7702.supported && (
            <div className="error">
              None of the RPCs for this chain processed an EIP-7702 authorization ({rpcStatus.eip7702.reason}).
              The rescue cannot run here. Try your own RPC below, or a different chain.
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleUseRpc} className="custom-rpc">
        <label htmlFor="custom-rpc-url"><strong>Use your own RPC</strong> (optional)</label>
        <p className="hint">
          Works for any chain. The chain is detected from the RPC. On Ethereum, a private RPC such as
          Flashbots Protect (https://rpc.flashbots.net) keeps the rescue out of the public mempool until it
          is mined, so the attacker cannot react to it. Kept for this session only.
        </p>
        <div className="input-group">
          <input
            id="custom-rpc-url"
            type="url"
            value={rpcInput}
            onChange={(e) => setRpcInput(e.target.value)}
            placeholder="https://..."
          />
        </div>
        <button type="submit" disabled={rpcChecking || !rpcInput.trim()}>
          {rpcChecking ? 'Checking...' : 'Use This RPC'}
        </button>
        {customRpc && (
          <button type="button" onClick={() => setCustomRpc(null)} className="scan-select-all">
            Stop using {new URL(customRpc.url).host}
          </button>
        )}
        {rpcError && <div className="error">{rpcError}</div>}
      </form>

      {rescueWallet && (
        <>
          {balanceLoading ? (
            <div className="balance-loading">Checking balance...</div>
          ) : balance && (
            <div className={`balance-info ${!balance.hasBalance ? 'zero-balance' : ''}`}>
              <p><strong>Rescue Wallet Balance:</strong> {balance.formatted} {balance.symbol}</p>
            </div>
          )}
        </>
      )}

      {warning && <div className="warning">{warning}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
