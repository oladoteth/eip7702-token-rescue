/**
 * App Context - Simplified without AppKit
 */

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ethers } from 'ethers';
import { getNetworkByChainId } from '../utils/networks';
import { selectRescueProvider } from '../utils/providerUtils';
import { probeEip7702 } from '../utils/eip7702Probe';
import { RESCUE_DELEGATE_ABI } from '../contracts/rescueDelegate.js';


const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Local app state
  const [rescueWallet, setRescueWallet] = useState(null); // Private key wallet for paying gas
  const [compromisedWallet, setCompromisedWallet] = useState(null);
  // Destination for rescued assets: { address, source: 'connected'|'generated'|'imported'|'rescue',
  // privateKey? (generated/imported), eip1193? (connected wallet provider), walletName? }
  const [safeWallet, setSafeWallet] = useState(null);
  // Bumped after a funding transfer so balance displays re-read.
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  // Provider and its 7702 check, tagged with the chain they were set up for. They are only
  // exposed when that chain is the current one, so a render right after a chain switch can
  // never pair the new chain with the previous chain's provider.
  const [providerState, setProviderState] = useState(null);
  const [signer, setSigner] = useState(null);
  const [batcherContract, setBatcherContract] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [batchCalls, setBatchCalls] = useState([]);
  const [selectedChainId, setSelectedChainId] = useState(null); // Manually selected chain
  // User-supplied RPC for this session only: { url, chainId, network? }. network is set for
  // a chain that is not in networks.js.
  const [customRpc, setCustomRpc] = useState(null);
  
  // Track previous chainId for network change detection
  const prevChainIdRef = useRef(null);

  // Derive current chain from selectedChainId. A custom RPC for that chain is tried first.
  const currentChain = useMemo(() => {
    if (!selectedChainId) return null;
    const custom = customRpc?.chainId === selectedChainId ? customRpc : null;
    const base = getNetworkByChainId(selectedChainId) ?? custom?.network;
    if (!base) return null;
    if (!custom) return base;
    return { ...base, rpcUrls: [custom.url, ...(base.rpcUrls ?? []).filter((url) => url !== custom.url)] };
  }, [selectedChainId, customRpc]);
  
  // Pick an RPC that answers for this chain and simulates EIP-7702. Only the chain and its
  // RPC list trigger this: probing costs several RPC calls.
  // Identifies the exact chain and RPC list a provider was checked for.
  const rpcKey = currentChain ? `${currentChain.chainId}|${(currentChain.rpcUrls || [currentChain.rpcUrl]).join(',')}` : null;

  useEffect(() => {
    if (!currentChain?.chainId) return;
    let isMounted = true;
    const key = rpcKey;

    const rpcUrls = currentChain.rpcUrls || [currentChain.rpcUrl];
    console.log('[AppContext] Selecting RPC for chain:', currentChain.chainId);
    selectRescueProvider(rpcUrls, currentChain.chainId, probeEip7702)
      .then(({ provider: rpcProvider, url, eip7702 }) => {
        if (!isMounted) return;
        // Fail closed: an RPC that does not simulate 7702 never becomes the app's provider,
        // so no code path can build, estimate or send a rescue through it.
        if (eip7702.supported !== true) rpcProvider.destroy();
        setProviderState({
          key,
          provider: eip7702.supported === true ? rpcProvider : null,
          status: { url, eip7702 }
        });
      })
      .catch((error) => {
        console.error('[AppContext] Error creating RPC provider:', error);
        if (isMounted) setProviderState({ key, provider: null, status: { error: error.message } });
      });

    return () => {
      isMounted = false;
    };
  }, [rpcKey]);

  // Exposed only for the exact chain and RPC list it was checked for. During a switch, or
  // while a changed RPC list is re-checked, there is no provider rather than a stale one.
  const isCurrent = providerState != null && providerState.key === rpcKey;
  const provider = isCurrent ? providerState.provider : null;
  // RPC in use and its live EIP-7702 check: { url, eip7702: { supported, reason } } or { error }.
  const rpcStatus = isCurrent ? providerState.status : null;

  // Signing wallets are derived from the current verified provider on every render, never
  // stored, so they cannot point at a previous chain's RPC. null when there is no provider.
  const connect = useCallback(
    (stored) => stored && { ...stored, wallet: stored.privateKey && provider ? new ethers.Wallet(stored.privateKey, provider) : null },
    [provider]
  );
  const rescueWalletView = useMemo(() => connect(rescueWallet), [connect, rescueWallet]);
  const compromisedWalletView = useMemo(() => connect(compromisedWallet), [connect, compromisedWallet]);

  // Function to clear all application state and localStorage
  const clearAllState = useCallback((clearRescueWallet = false) => {
    console.log('[AppContext] Clearing all application state...');
    
    // Clear React state
    if (clearRescueWallet) {
      setRescueWallet(null);
      setSafeWallet(null);
    }
    setCompromisedWallet(null);
    setBatcherContract(null);
    setContracts([]);
    setBatchCalls([]);
    
    // Clear localStorage for all chains
    import('../utils/contractDeployment').then(({ clearAllStoredContracts }) => {
      clearAllStoredContracts();
      console.log('[AppContext] Cleared all stored contract addresses from localStorage');
    });
  }, []);

  // Reset ALL flow state on chain change - start fresh
  useEffect(() => {
    const currentChainId = selectedChainId;
    const prevChainId = prevChainIdRef.current;
    
    if (currentChainId && prevChainId !== null && prevChainId !== currentChainId) {
      console.log('[AppContext] Chain changed, resetting entire flow:', prevChainId, '->', currentChainId);
      // Reset everything - compromised wallet, batcher, contracts, batch calls
      // Note: rescueWallet is kept - user can reuse it on different chains
      setCompromisedWallet(null);
      setBatcherContract(null);
      setContracts([]);
      setBatchCalls([]);
      
      // Clear localStorage for the previous chain
      import('../utils/contractDeployment').then(({ clearStoredContracts }) => {
        clearStoredContracts(prevChainId);
        console.log('[AppContext] Cleared stored contracts for previous chain:', prevChainId);
      });
    }
    
    // Update ref after processing
    if (currentChainId !== null) {
      prevChainIdRef.current = currentChainId;
    }
  }, [selectedChainId]);

  // Compromised wallet management
  const setCompromisedWalletFromPrivateKey = useCallback((privateKey) => {
    try {
      if (!provider) {
        throw new Error('Provider not initialized. Please select a chain first.');
      }
      const wallet = new ethers.Wallet(privateKey, provider);
      setCompromisedWallet({
        address: wallet.address,
        privateKey: privateKey,
        wallet
      });
    } catch (error) {
      console.error('Error setting compromised wallet:', error);
      throw error;
    }
  }, [provider]);

  // Contract management
  const addContract = useCallback((contract) => {
    setContracts(prev => [...prev, contract]);
  }, []);

  const removeContract = useCallback((index) => {
    setContracts(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Batch call management
  // The native sweep stays last: earlier calls (unstake, claim) may release more ETH.
  const addBatchCall = useCallback((call) => {
    setBatchCalls(prev => {
      const sweepIndex = prev.findIndex((c) => c.source === 'native');
      if (call.source === 'native') {
        return sweepIndex === -1 ? [...prev, call] : prev;
      }
      if (sweepIndex === -1) {
        return [...prev, call];
      }
      return [...prev.slice(0, sweepIndex), call, ...prev.slice(sweepIndex)];
    });
  }, []);

  const removeBatchCall = useCallback((index) => {
    setBatchCalls(prev => prev.filter((_, i) => i !== index));
  }, []);

  const reorderBatchCall = useCallback((fromIndex, toIndex) => {
    setBatchCalls(prev => {
      const newCalls = [...prev];
      const [removed] = newCalls.splice(fromIndex, 1);
      newCalls.splice(toIndex, 0, removed);
      return newCalls;
    });
  }, []);

  const clearBatchCalls = useCallback(() => {
    setBatchCalls([]);
  }, []);

  const refreshBalances = useCallback(() => {
    setBalanceRefreshKey((key) => key + 1);
  }, []);

  // Batcher contract management
  const setBatcherAddress = useCallback((address) => {
    if (address && provider) {
      const contract = new ethers.Contract(address, RESCUE_DELEGATE_ABI, provider);
      setBatcherContract({ address, contract });
    } else {
      setBatcherContract(null);
    }
  }, [provider]);

  // Create connectedWallet object for backward compatibility
  // Uses rescueWallet
  const connectedWallet = useMemo(() => {
    if (rescueWalletView?.wallet) {
      return {
        address: rescueWalletView.address,
        signer: rescueWalletView.wallet, // Wallet is a signer
        provider: provider,
        chainId: selectedChainId,
        isConnected: true
      };
    }
    return null;
  }, [rescueWalletView, provider, selectedChainId]);

  const value = {
    // Wallet state
    connectedWallet,
    isConnected: !!rescueWallet,
    address: rescueWallet?.address || null,
    chainId: selectedChainId,
    
    // Network state
    currentChain,
    customRpc,
    rpcStatus,
    setCustomRpc,
    
    // Provider state
    provider,
    signer,
    
    // App state. Wallets carry a `wallet` signer for the current verified provider, or null.
    rescueWallet: rescueWalletView,
    compromisedWallet: compromisedWalletView,
    safeWallet,
    balanceRefreshKey,
    batcherContract,
    contracts,
    batchCalls,
    selectedChainId,
    
    // Functions
    setRescueWallet,
    setSafeWallet,
    refreshBalances,
    setSelectedChainId,
    setCompromisedWalletFromPrivateKey,
    setCompromisedWallet,
    addContract,
    removeContract,
    addBatchCall,
    removeBatchCall,
    reorderBatchCall,
    clearBatchCalls,
    setBatcherAddress,
    clearAllState
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}