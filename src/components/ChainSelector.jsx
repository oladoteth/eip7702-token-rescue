/**
 * Chain Selector Component
 * Works with RPC providers - no wallet connection required
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../contexts/AppContext';
import { getAvailableNetworks } from '../utils/chainManagement';
import { ethers } from 'ethers';

export function ChainSelector() {
  const { 
    rescueWallet, 
    currentChain, 
    selectedChainId, 
    setSelectedChainId, 
    provider 
  } = useApp();
  
  const [balance, setBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);

  const networks = getAvailableNetworks();

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
  }, [rescueWallet?.address, selectedChainId, provider, checkBalance]);

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
              {network.name} (Chain ID: {network.chainId})
            </option>
          ))}
        </select>
      </div>

      {currentChain && (
        <div className="current-chain-info">
          <p><strong>Current Chain:</strong> {currentChain.name}</p>
        </div>
      )}

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
