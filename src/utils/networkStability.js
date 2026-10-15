/**
 * Network Stability Utilities
 * Handles network change detection and waiting for network to stabilize
 */

/**
 * Wait for network to stabilize after a change
 * @param {ethers.Provider} provider - Provider instance
 * @param {number} expectedChainId - Expected chain ID
 * @param {number} maxWaitTime - Maximum time to wait in ms (default 5000)
 * @returns {Promise<boolean>} True if network stabilized, false if timeout
 */
export async function waitForNetworkStability(provider, expectedChainId, maxWaitTime = 5000) {
  const startTime = Date.now();
  const checkInterval = 200; // Check every 200ms
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      
      if (currentChainId === expectedChainId) {
        // Network matches, wait a bit more to ensure it's stable
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Verify it's still the same
        const network2 = await provider.getNetwork();
        if (Number(network2.chainId) === expectedChainId) {
          return true;
        }
      }
    } catch (error) {
      // If it's a network change error, continue waiting
      if (error.code === 'NETWORK_ERROR' && error.message?.includes('network changed')) {
        // Continue waiting
      } else {
        // Other error, might be transient
        console.warn('Network check error (will retry):', error.message);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  return false;
}

/**
 * Execute a function with network stability handling
 * @param {Function} fn - Function to execute
 * @param {ethers.Provider} provider - Provider instance
 * @param {number} expectedChainId - Expected chain ID
 * @param {number} retries - Number of retries (default 3)
 * @returns {Promise<any>} Result of the function
 */
export async function executeWithStableNetwork(fn, provider, expectedChainId, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Wait for network to stabilize before executing
      const isStable = await waitForNetworkStability(provider, expectedChainId, 3000);
      if (!isStable && attempt < retries - 1) {
        console.warn(`Network not stable, retrying... (attempt ${attempt + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      
      // Execute the function
      return await fn();
    } catch (error) {
      // Handle network change errors
      if (error.code === 'NETWORK_ERROR' && error.message?.includes('network changed')) {
        if (attempt < retries - 1) {
          console.warn(`Network changed during execution, retrying... (attempt ${attempt + 1}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        } else {
          throw new Error(`Network changed and could not stabilize after ${retries} attempts`);
        }
      }
      
      // Other errors, throw immediately
      throw error;
    }
  }
}

/**
 * Get current network with retry logic
 * @param {ethers.Provider} provider - Provider instance
 * @param {number} retries - Number of retries (default 3)
 * @returns {Promise<{chainId: number, name: string}>}
 */
export async function getStableNetwork(provider, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const network = await provider.getNetwork();
      return {
        chainId: Number(network.chainId),
        name: network.name
      };
    } catch (error) {
      if (error.code === 'NETWORK_ERROR' && error.message?.includes('network changed')) {
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
      }
      throw error;
    }
  }
}

