/**
 * Centralized Network Management
 * Handles network changes, state synchronization, and operation coordination
 */

import { ethers } from 'ethers';
import { getNetworkByChainId } from './networks';

class NetworkManager {
  constructor() {
    this.currentChainId = null;
    this.provider = null;
    this.listeners = new Set();
    this.operationLocks = new Map(); // Track ongoing operations by operation type
    this.expectedChainChange = null; // Track expected chain changes (user-initiated)
    this.chainChangeTimeout = null; // Timeout to clear expected change flag
    this.listenersSetup = false; // Track if listeners are already setup
    this.debounceTimeout = null; // Debounce chain changes
    this.lastChainChange = null; // Track last chain change time
    this.duplicateEventCount = 0; // Track duplicate events for debugging
  }

  /**
   * Initialize network manager with provider
   */
  initialize(provider) {
    this.provider = provider;
    this.setupNetworkListeners();
  }

  /**
   * Setup listeners for network changes (only once)
   */
  setupNetworkListeners() {
    if (typeof window === 'undefined' || !window.ethereum) {
      return;
    }

    // Only setup listeners once
    if (this.listenersSetup) {
      return;
    }

    this.listenersSetup = true;

    // Listen for chain changes - following EIP-1193 best practices
    // MetaMask fires chainChanged with hex string, we need to compare with current state
    window.ethereum.on('chainChanged', (chainIdHex) => {
      const chainId = parseInt(chainIdHex, 16);
      
      // Immediate check: if this is the same as current chain, ignore it
      // This is the recommended pattern from MetaMask docs
      if (this.currentChainId === chainId) {
        this.duplicateEventCount++;
        console.warn(`[NetworkManager] Ignoring duplicate chainChanged event (chainId: ${chainId}, current: ${this.currentChainId}, duplicates filtered: ${this.duplicateEventCount})`);
        return;
      }
      
      // This is a new chain change - update state immediately
      const oldChainId = this.currentChainId;
      this.currentChainId = chainId;
      
      // Log the change
      if (this.duplicateEventCount > 0) {
        console.log(`[NetworkManager] Chain changed: ${oldChainId} -> ${chainId} (filtered ${this.duplicateEventCount} duplicate event(s) before this)`);
        this.duplicateEventCount = 0;
      } else {
        console.log(`[NetworkManager] Chain changed: ${oldChainId} -> ${chainId}`);
      }
      
      // Clear any pending debounced handler
      if (this.debounceTimeout) {
        clearTimeout(this.debounceTimeout);
      }
      
      // Debounce listener notifications (not state update) to batch rapid changes
      // This allows us to update state immediately but batch listener calls
      this.debounceTimeout = setTimeout(() => {
        this.notifyListeners(chainId, oldChainId);
      }, 150);
    });

    // Listen for account changes
    window.ethereum.on('accountsChanged', (accounts) => {
      if (accounts.length === 0) {
        // User disconnected wallet
        this.handleNetworkChange(null);
      }
    });
  }

  /**
   * Notify listeners of network change
   * This is called after debounce to batch rapid changes
   */
  async notifyListeners(newChainId, oldChainId) {
    // Double-check state is still correct (in case another change happened during debounce)
    if (this.currentChainId !== newChainId) {
      console.warn(`[NetworkManager] Chain changed again during debounce (was ${newChainId}, now ${this.currentChainId}). Skipping notification.`);
      return;
    }

    // Notify all listeners
    this.listeners.forEach(listener => {
      try {
        listener(newChainId, oldChainId);
      } catch (error) {
        console.error('[NetworkManager] Listener error:', error);
      }
    });

    // Clear operation locks on network change
    this.operationLocks.clear();
  }

  /**
   * Register a listener for network changes
   */
  onNetworkChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get current chain ID
   */
  getCurrentChainId() {
    return this.currentChainId;
  }

  /**
   * Set current chain ID
   */
  setCurrentChainId(chainId) {
    this.currentChainId = chainId;
  }

  /**
   * Mark an expected chain change (user-initiated)
   */
  expectChainChange(chainId) {
    this.expectedChainChange = chainId;
    // Clear the flag after 10 seconds (network should have changed by then)
    if (this.chainChangeTimeout) {
      clearTimeout(this.chainChangeTimeout);
    }
    this.chainChangeTimeout = setTimeout(() => {
      this.expectedChainChange = null;
    }, 10000);
  }

  /**
   * Check if a chain change is expected (user-initiated)
   */
  isExpectedChainChange(chainId) {
    return this.expectedChainChange === chainId;
  }

  /**
   * Clear expected chain change flag
   */
  clearExpectedChainChange() {
    this.expectedChainChange = null;
    if (this.chainChangeTimeout) {
      clearTimeout(this.chainChangeTimeout);
      this.chainChangeTimeout = null;
    }
  }

  /**
   * Acquire operation lock
   * @param {string} operationType - Type of operation (e.g., 'deploy', 'rescue')
   * @returns {boolean} True if lock acquired, false if already locked
   */
  acquireLock(operationType) {
    if (this.operationLocks.has(operationType)) {
      console.warn(`[NetworkManager] Operation ${operationType} is already in progress`);
      return false;
    }
    this.operationLocks.set(operationType, Date.now());
    return true;
  }

  /**
   * Release operation lock
   */
  releaseLock(operationType) {
    this.operationLocks.delete(operationType);
  }

  /**
   * Check if operation is locked
   */
  isLocked(operationType) {
    return this.operationLocks.has(operationType);
  }

  /**
   * Wait for network to be stable
   * @param {number} expectedChainId - Expected chain ID
   * @param {number} timeout - Timeout in ms
   */
  async waitForNetworkStable(expectedChainId, timeout = 5000) {
    const startTime = Date.now();
    const checkInterval = 200;

    while (Date.now() - startTime < timeout) {
      if (this.currentChainId === expectedChainId) {
        // Wait a bit more to ensure stability
        await new Promise(resolve => setTimeout(resolve, 500));
        if (this.currentChainId === expectedChainId) {
          return true;
        }
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    return false;
  }

  /**
   * Execute operation with network check and lock
   */
  async executeWithNetworkCheck(operationType, expectedChainId, operation) {
    // Check if operation is already in progress
    if (!this.acquireLock(operationType)) {
      throw new Error(`${operationType} is already in progress`);
    }

    try {
      // Verify network matches
      if (this.currentChainId !== expectedChainId) {
        throw new Error(`Network mismatch. Expected ${expectedChainId}, got ${this.currentChainId}`);
      }

      // Wait for network stability
      const isStable = await this.waitForNetworkStable(expectedChainId, 3000);
      if (!isStable) {
        throw new Error(`Network not stable. Current: ${this.currentChainId}, Expected: ${expectedChainId}`);
      }

      // Execute operation
      return await operation();
    } finally {
      this.releaseLock(operationType);
    }
  }

  /**
   * Cleanup
   */
  cleanup() {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    if (typeof window !== 'undefined' && window.ethereum) {
      window.ethereum.removeAllListeners('chainChanged');
      window.ethereum.removeAllListeners('accountsChanged');
    }
    this.listeners.clear();
    this.operationLocks.clear();
    this.listenersSetup = false;
  }
}

// Singleton instance
export const networkManager = new NetworkManager();

