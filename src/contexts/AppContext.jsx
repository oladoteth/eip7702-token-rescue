/**
 * App Context - Simplified without AppKit
 */

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ethers } from 'ethers';
import { getNetworkByChainId } from '../utils/networks';
import { createProviderWithFallback } from '../utils/providerUtils';


const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Local app state
  const [rescueWallet, setRescueWallet] = useState(null); // Private key wallet for paying gas
  const [compromisedWallet, setCompromisedWallet] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [batcherContract, setBatcherContract] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [batchCalls, setBatchCalls] = useState([]);
  const [selectedChainId, setSelectedChainId] = useState(null); // Manually selected chain
  
  // Track previous chainId for network change detection
  const prevChainIdRef = useRef(null);

  // Derive current chain from selectedChainId
  const currentChain = useMemo(() => {
    if (selectedChainId) {
      return getNetworkByChainId(selectedChainId);
    }
    return null;
  }, [selectedChainId]);
  
  // Create provider from RPC URL when chain is selected (with fallback)
  useEffect(() => {
    if (currentChain && currentChain.chainId) {
      let isMounted = true;
      
      const createProvider = async () => {
        try {
          // Use fallback RPC URLs if available, otherwise use single rpcUrl
          const rpcUrls = currentChain.rpcUrls || [currentChain.rpcUrl];
          
          console.log('[AppContext] Creating provider with fallback RPCs for chain:', currentChain.chainId);
          const rpcProvider = await createProviderWithFallback(rpcUrls, currentChain.chainId);
          
          if (!isMounted) return;
          
          setProvider(rpcProvider);
          
          // If rescue wallet exists, reconnect it to the new provider
          if (rescueWallet && rescueWallet.privateKey) {
            const wallet = new ethers.Wallet(rescueWallet.privateKey, rpcProvider);
            setRescueWallet({
              ...rescueWallet,
              wallet: wallet
            });
          }
          
          // If compromised wallet exists, reconnect it to the new provider
          if (compromisedWallet && compromisedWallet.privateKey) {
            const wallet = new ethers.Wallet(compromisedWallet.privateKey, rpcProvider);
            setCompromisedWallet({
              ...compromisedWallet,
              wallet: wallet
            });
          }
        } catch (error) {
          console.error('[AppContext] Error creating RPC provider:', error);
          if (isMounted) {
            setProvider(null);
          }
        }
      };
      
      createProvider();
      
      return () => {
        isMounted = false;
      };
    }
  }, [currentChain?.chainId, currentChain?.rpcUrl, currentChain?.rpcUrls, rescueWallet?.privateKey, compromisedWallet?.privateKey]);

  // Function to clear all application state and localStorage
  const clearAllState = useCallback((clearRescueWallet = false) => {
    console.log('[AppContext] Clearing all application state...');
    
    // Clear React state
    if (clearRescueWallet) {
      setRescueWallet(null);
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
  const addBatchCall = useCallback((call) => {
    setBatchCalls(prev => [...prev, call]);
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

  // Batcher contract management
  const setBatcherAddress = useCallback((address) => {
    if (address && provider) {
      import('../utils/contracts').then(({ BATCHER_ABI }) => {
        const contract = new ethers.Contract(address, BATCHER_ABI, provider);
        setBatcherContract({ address, contract });
      });
    } else {
      setBatcherContract(null);
    }
  }, [provider]);

  // Create connectedWallet object for backward compatibility
  // Uses rescueWallet
  const connectedWallet = useMemo(() => {
    if (rescueWallet && rescueWallet.wallet && provider) {
      return {
        address: rescueWallet.address,
        signer: rescueWallet.wallet, // Wallet is a signer
        provider: provider,
        chainId: selectedChainId,
        isConnected: true
      };
    }
    return null;
  }, [rescueWallet, provider, selectedChainId]);

  const value = {
    // Wallet state
    connectedWallet,
    isConnected: !!rescueWallet,
    address: rescueWallet?.address || null,
    chainId: selectedChainId,
    
    // Network state
    currentChain,
    
    // Provider state
    provider,
    signer,
    
    // App state
    rescueWallet,
    compromisedWallet,
    batcherContract,
    contracts,
    batchCalls,
    selectedChainId,
    
    // Functions
    setRescueWallet,
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