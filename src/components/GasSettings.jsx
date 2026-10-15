import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { estimateTransactionCost, checkBalanceSufficient, getWalletBalance } from '../utils/balanceChecker';
import { encodeBatchExecuteCalls } from '../utils/contracts';
import { executeWithRetry } from '../utils/providerUtils';
import { ethers } from 'ethers';

// Minimum gas settings constants
const MIN_MAX_FEE_PER_GAS = ethers.parseUnits('1', 'gwei'); // 1 gwei minimum
const MIN_MAX_PRIORITY_FEE_PER_GAS = ethers.parseUnits('1', 'gwei'); // 1 gwei minimum
const MIN_GAS_LIMIT = 100000n; // 100,000 minimum
const GAS_LIMIT_BUFFER = 100000n; // 100,000 gas buffer added to estimate

/**
 * Get fee data with fallback for networks that don't support maxPriorityFeePerGas
 */
async function getFeeDataSafe(provider) {
  try {
    const feeData = await provider.getFeeData();
    
    // If maxPriorityFeePerGas is null/undefined, some networks don't support it
    // Fallback to gasPrice or set minimum
    if (!feeData.maxPriorityFeePerGas) {
      if (feeData.gasPrice) {
        // For legacy networks, use gasPrice and set priority fee to minimum
        return {
          ...feeData,
          maxFeePerGas: feeData.gasPrice || MIN_MAX_FEE_PER_GAS,
          maxPriorityFeePerGas: MIN_MAX_PRIORITY_FEE_PER_GAS
        };
      } else {
        // Fallback to minimums
        return {
          ...feeData,
          maxFeePerGas: feeData.maxFeePerGas || MIN_MAX_FEE_PER_GAS,
          maxPriorityFeePerGas: MIN_MAX_PRIORITY_FEE_PER_GAS
        };
      }
    }
    
    // Ensure minimums are met
    return {
      ...feeData,
      maxFeePerGas: feeData.maxFeePerGas && feeData.maxFeePerGas >= MIN_MAX_FEE_PER_GAS 
        ? feeData.maxFeePerGas 
        : MIN_MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas >= MIN_MAX_PRIORITY_FEE_PER_GAS
        ? feeData.maxPriorityFeePerGas
        : MIN_MAX_PRIORITY_FEE_PER_GAS
    };
  } catch (error) {
    // If getFeeData fails (e.g., eth_maxPriorityFeePerGas not supported), use fallback
    if (error.message?.includes('maxPriorityFeePerGas') || error.code === -32601) {
      console.warn('[GasSettings] Network does not support maxPriorityFeePerGas, using fallback');
      try {
        // Try to get gasPrice as fallback
        const block = await provider.getBlock('latest');
        const gasPrice = block?.baseFeePerGas 
          ? block.baseFeePerGas * 2n 
          : await provider.getFeeData().then(fd => fd.gasPrice || MIN_MAX_FEE_PER_GAS);
        
        return {
          maxFeePerGas: gasPrice || MIN_MAX_FEE_PER_GAS,
          maxPriorityFeePerGas: MIN_MAX_PRIORITY_FEE_PER_GAS,
          gasPrice: gasPrice || MIN_MAX_FEE_PER_GAS
        };
      } catch (fallbackError) {
        // Ultimate fallback to minimums
        return {
          maxFeePerGas: MIN_MAX_FEE_PER_GAS,
          maxPriorityFeePerGas: MIN_MAX_PRIORITY_FEE_PER_GAS,
          gasPrice: MIN_MAX_FEE_PER_GAS
        };
      }
    }
    throw error;
  }
}

export function GasSettings({ onGasSettingsReady }) {
  const {
    rescueWallet,
    compromisedWallet,
    batcherContract,
    batchCalls,
    currentChain,
    provider
  } = useApp();

  const [gasMode, setGasMode] = useState('automatic'); // 'automatic' or 'custom'
  const [maxFeePerGas, setMaxFeePerGas] = useState('');
  const [maxPriorityFeePerGas, setMaxPriorityFeePerGas] = useState('');
  const [gasLimit, setGasLimit] = useState('');
  const [estimatedCost, setEstimatedCost] = useState(null);
  const [balanceCheck, setBalanceCheck] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [gasEstimationDetails, setGasEstimationDetails] = useState(null);

  // Auto-populate custom fields when switching from automatic to custom
  useEffect(() => {
    if (gasMode === 'custom' && provider && batchCalls.length > 0 && compromisedWallet && batcherContract) {
      // Fetch current gas prices and estimated gas limit, then populate fields
      const populateFields = async () => {
        try {
          const feeData = await executeWithRetry(provider, async (p) => await getFeeDataSafe(p), 3);
          
          // Only populate if fields are empty
          if (!maxFeePerGas) {
            setMaxFeePerGas(ethers.formatUnits(feeData.maxFeePerGas || MIN_MAX_FEE_PER_GAS, 'gwei'));
          }
          if (!maxPriorityFeePerGas) {
            setMaxPriorityFeePerGas(ethers.formatUnits(feeData.maxPriorityFeePerGas || MIN_MAX_PRIORITY_FEE_PER_GAS, 'gwei'));
          }
          
          // Also populate gas limit if empty - estimate it
          if (!gasLimit) {
            try {
              const batchData = encodeBatchExecuteCalls(batchCalls);
              const totalValue = batchCalls.reduce((sum, call) => {
                try {
                  return sum + BigInt(call.value || 0);
                } catch {
                  return sum;
                }
              }, 0n);
              
              const txRequest = {
                to: compromisedWallet.address,
                data: batchData,
                value: totalValue,
                from: rescueWallet.address
              };
              
              const estimated = await executeWithRetry(
                provider,
                async (p) => await p.estimateGas(txRequest),
                3
              );
              const finalLimit = estimated + 100000n;
              setGasLimit(finalLimit.toString());
            } catch (err) {
              console.warn('[GasSettings] Failed to estimate gas limit for auto-populate:', err);
              setGasLimit(MIN_GAS_LIMIT.toString());
            }
          }
        } catch (err) {
          console.warn('[GasSettings] Failed to auto-populate gas fields:', err);
        }
      };
      
      populateFields();
    }
  }, [gasMode, provider, batchCalls.length, rescueWallet?.address, compromisedWallet?.address, batcherContract?.address]);

  useEffect(() => {
    if (batchCalls.length > 0 && rescueWallet && compromisedWallet && batcherContract) {
      estimateGas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchCalls.length, rescueWallet?.address, compromisedWallet?.address, batcherContract?.address, gasMode, maxFeePerGas, maxPriorityFeePerGas, gasLimit, provider]);

  const estimateGas = async () => {
    // Validate all required dependencies
    if (!provider) {
      setError('Provider not available. Please select a chain.');
      return;
    }
    if (!rescueWallet) {
      setError('Rescue wallet not set. Please setup rescue wallet first.');
      return;
    }
    if (!rescueWallet.address) {
      setError('Rescue wallet address not available.');
      return;
    }
    if (!compromisedWallet || !batcherContract || batchCalls.length === 0) {
      return;
    }

    setEstimating(true);
    setError(null);
    setWarning(null);

    try {
      // Build transaction request
      const batchData = encodeBatchExecuteCalls(batchCalls);
      
      // Calculate total value from batch calls (sum of all call values)
      const totalValue = batchCalls.reduce((sum, call) => {
        try {
          return sum + BigInt(call.value || 0);
        } catch {
          return sum;
        }
      }, 0n);
      
      // Get fee data with safe fallback and retry logic
      let feeData;
      try {
        feeData = await executeWithRetry(provider, async (p) => await getFeeDataSafe(p), 3);
      } catch (error) {
        console.error('[GasSettings] Failed to get fee data after retries:', error);
        // Use fallback minimum values
        feeData = {
          maxFeePerGas: MIN_MAX_FEE_PER_GAS,
          maxPriorityFeePerGas: MIN_MAX_PRIORITY_FEE_PER_GAS,
          gasPrice: MIN_MAX_FEE_PER_GAS
        };
        setWarning('⚠️ Unable to fetch current gas prices. Using minimum values. Please check your network connection.');
      }

      // Ensure minimums
      const safeMaxFeePerGas = feeData.maxFeePerGas >= MIN_MAX_FEE_PER_GAS 
        ? feeData.maxFeePerGas 
        : MIN_MAX_FEE_PER_GAS;
      const safeMaxPriorityFeePerGas = feeData.maxPriorityFeePerGas >= MIN_MAX_PRIORITY_FEE_PER_GAS
        ? feeData.maxPriorityFeePerGas
        : MIN_MAX_PRIORITY_FEE_PER_GAS;

      // Build transaction request for gas estimation
      // Transaction structure: rescue wallet -> compromised wallet
      // Data: batcher contract execution data (batchExecuteCalls with targets, datas, values)
      let txRequest;
      if (gasMode === 'automatic') {
        txRequest = {
          to: compromisedWallet.address, // Transaction TO compromised wallet
          data: batchData, // Batcher execution data (batchExecuteCalls encoded)
          value: totalValue, // Include total value from batch calls
          from: rescueWallet.address // Transaction FROM rescue wallet (pays gas)
        };
      } else {
        // Custom gas settings - apply minimums
        const customMaxFeePerGas = maxFeePerGas 
          ? ethers.parseUnits(Math.max(parseFloat(maxFeePerGas), 1).toString(), 'gwei')
          : safeMaxFeePerGas;
        const customMaxPriorityFeePerGas = maxPriorityFeePerGas
          ? ethers.parseUnits(Math.max(parseFloat(maxPriorityFeePerGas), 1).toString(), 'gwei')
          : safeMaxPriorityFeePerGas;
        const customGasLimit = gasLimit 
          ? BigInt(Math.max(parseInt(gasLimit), Number(MIN_GAS_LIMIT)))
          : undefined;

        txRequest = {
          to: compromisedWallet.address, // Transaction TO compromised wallet
          data: batchData, // Batcher execution data (batchExecuteCalls encoded)
          value: totalValue, // Include total value from batch calls
          from: rescueWallet.address, // Transaction FROM rescue wallet (pays gas)
          maxFeePerGas: customMaxFeePerGas,
          maxPriorityFeePerGas: customMaxPriorityFeePerGas,
          gasLimit: customGasLimit
        };
      }

      // Estimate gas limit with retry logic
      let estimatedGasLimit;
      try {
        estimatedGasLimit = await executeWithRetry(
          provider, 
          async (p) => await p.estimateGas(txRequest),
          3
        );
      } catch (error) {
        console.warn('[GasSettings] Gas estimation failed after retries, using default:', error);
        estimatedGasLimit = MIN_GAS_LIMIT;
        setWarning('⚠️ Gas estimation failed. Using minimum gas limit. Transaction may fail if insufficient.');
      }

      // Apply buffer: estimated + 100,000, but never below 100,000
      const GAS_LIMIT_BUFFER = 100000n;
      const bufferedGasLimit = estimatedGasLimit + GAS_LIMIT_BUFFER;
      const finalGasLimit = bufferedGasLimit >= MIN_GAS_LIMIT ? bufferedGasLimit : MIN_GAS_LIMIT;

      // Store estimation details for display
      setGasEstimationDetails({
        rawEstimate: estimatedGasLimit,
        bufferAmount: GAS_LIMIT_BUFFER,
        finalGasLimit: finalGasLimit
      });

      // Determine final gas values based on mode
      let finalMaxFeePerGas, finalMaxPriorityFeePerGas, finalGasLimitForCost;
      
      if (gasMode === 'automatic') {
        finalMaxFeePerGas = safeMaxFeePerGas;
        finalMaxPriorityFeePerGas = safeMaxPriorityFeePerGas;
        finalGasLimitForCost = finalGasLimit;
      } else {
        // Use custom values with minimums enforced
        finalMaxFeePerGas = maxFeePerGas 
          ? ethers.parseUnits(Math.max(parseFloat(maxFeePerGas), 1).toString(), 'gwei')
          : safeMaxFeePerGas;
        finalMaxPriorityFeePerGas = maxPriorityFeePerGas
          ? ethers.parseUnits(Math.max(parseFloat(maxPriorityFeePerGas), 1).toString(), 'gwei')
          : safeMaxPriorityFeePerGas;
        finalGasLimitForCost = gasLimit 
          ? BigInt(Math.max(parseInt(gasLimit), Number(MIN_GAS_LIMIT)))
          : finalGasLimit;
      }

      // Estimate cost using final values (with gas limit included)
      const estimate = await estimateTransactionCost(provider, {
        ...txRequest,
        maxFeePerGas: finalMaxFeePerGas,
        maxPriorityFeePerGas: finalMaxPriorityFeePerGas,
        gasLimit: finalGasLimitForCost // This will be used instead of re-estimating
      });
      
      // Update estimate with the correct gas limit for display
      estimate.gasLimit = finalGasLimitForCost;
      estimate.totalCost = finalGasLimitForCost * estimate.gasPrice;
      estimate.formatted = ethers.formatEther(estimate.totalCost);
      
      setEstimatedCost(estimate);

      // Check balance (rescue wallet already validated above)
      if (rescueWallet && rescueWallet.address) {
        const balanceInfo = await getWalletBalance(provider, rescueWallet.address);
        // Total cost includes gas + value from batch calls
        const totalRequired = estimate.totalCost + totalValue;
        const check = checkBalanceSufficient(balanceInfo.balance, totalRequired);
        setBalanceCheck(check);

        if (!check.isSufficient) {
          setWarning(
            `⚠️ Insufficient balance! You need ${check.shortfallFormatted} ${currentChain?.nativeCurrency?.symbol || 'ETH'} more. ` +
            `Current: ${check.currentBalance}, Required: ${check.estimatedCost}. Please fund your rescue wallet.`
          );
        }
      }

      // Pass gas settings to parent with minimums enforced
      if (onGasSettingsReady) {
        onGasSettingsReady({
          mode: gasMode,
          maxFeePerGas: gasMode === 'automatic' 
            ? safeMaxFeePerGas
            : (maxFeePerGas ? ethers.parseUnits(Math.max(parseFloat(maxFeePerGas), 1).toString(), 'gwei') : safeMaxFeePerGas),
          maxPriorityFeePerGas: gasMode === 'automatic'
            ? safeMaxPriorityFeePerGas
            : (maxPriorityFeePerGas ? ethers.parseUnits(Math.max(parseFloat(maxPriorityFeePerGas), 1).toString(), 'gwei') : safeMaxPriorityFeePerGas),
          gasLimit: gasMode === 'automatic'
            ? finalGasLimit
            : (gasLimit ? BigInt(Math.max(parseInt(gasLimit), Number(MIN_GAS_LIMIT))) : finalGasLimit),
          estimatedCost: estimate.totalCost,
          totalValue: totalValue // Include total value for transaction
        });
      }
    } catch (err) {
      setError(err.message);
      console.error('Gas estimation error:', err);
    } finally {
      setEstimating(false);
    }
  };

  const handleGetCurrentGas = async () => {
    if (!provider) return;

    try {
      const feeData = await getFeeDataSafe(provider);
      setMaxFeePerGas(ethers.formatUnits(feeData.maxFeePerGas || MIN_MAX_FEE_PER_GAS, 'gwei'));
      setMaxPriorityFeePerGas(ethers.formatUnits(feeData.maxPriorityFeePerGas || MIN_MAX_PRIORITY_FEE_PER_GAS, 'gwei'));
    } catch (err) {
      setError('Failed to get current gas prices');
    }
  };

  if (batchCalls.length === 0) {
    return (
      <div className="gas-settings-empty">
        <p>Build batch transactions first to estimate gas costs.</p>
      </div>
    );
  }

  return (
    <div className="gas-settings">
      <h3>Gas Settings</h3>

      <div className="gas-mode-selector">
        <label>
          <input
            type="radio"
            value="automatic"
            checked={gasMode === 'automatic'}
            onChange={(e) => setGasMode(e.target.value)}
          />
          Automatic (Recommended)
        </label>
        <label>
          <input
            type="radio"
            value="custom"
            checked={gasMode === 'custom'}
            onChange={async (e) => {
              setGasMode(e.target.value);
              // Auto-populate when switching to custom
              if (provider && batchCalls.length > 0 && rescueWallet && compromisedWallet && batcherContract) {
                try {
                  const feeData = await executeWithRetry(provider, async (p) => await getFeeDataSafe(p), 3);
                  setMaxFeePerGas(ethers.formatUnits(feeData.maxFeePerGas || MIN_MAX_FEE_PER_GAS, 'gwei'));
                  setMaxPriorityFeePerGas(ethers.formatUnits(feeData.maxPriorityFeePerGas || MIN_MAX_PRIORITY_FEE_PER_GAS, 'gwei'));
                  
                  // Also estimate and populate gas limit
                  try {
                    const batchData = encodeBatchExecuteCalls(batchCalls);
                    const totalValue = batchCalls.reduce((sum, call) => {
                      try {
                        return sum + BigInt(call.value || 0);
                      } catch {
                        return sum;
                      }
                    }, 0n);
                    
                    const txRequest = {
                      to: compromisedWallet.address,
                      data: batchData,
                      value: totalValue,
                      from: rescueWallet.address
                    };
                    
                    const estimated = await executeWithRetry(
                      provider,
                      async (p) => await p.estimateGas(txRequest),
                      3
                    );
                    const finalLimit = estimated + 100000n;
                    setGasLimit(finalLimit.toString());
                  } catch (err) {
                    console.warn('[GasSettings] Failed to estimate gas limit:', err);
                    setGasLimit(MIN_GAS_LIMIT.toString());
                  }
                } catch (err) {
                  console.warn('[GasSettings] Failed to auto-populate:', err);
                }
              }
            }}
          />
          Custom
        </label>
      </div>

      {gasMode === 'custom' && (
        <div className="custom-gas-inputs">
          <div className="gas-input-group">
            <label>Max Fee Per Gas (Gwei) - Minimum: 1 Gwei</label>
            <input
              type="number"
              value={maxFeePerGas}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || parseFloat(val) >= 1) {
                  setMaxFeePerGas(val);
                }
              }}
              placeholder="Auto"
              min="1"
              step="0.1"
            />
          </div>
          <div className="gas-input-group">
            <label>Max Priority Fee Per Gas (Gwei) - Minimum: 1 Gwei</label>
            <input
              type="number"
              value={maxPriorityFeePerGas}
              onChange={(e) => {
                const val = e.target.value;
                // Allow empty string or values >= 1
                if (val === '' || (!isNaN(parseFloat(val)) && parseFloat(val) >= 1)) {
                  setMaxPriorityFeePerGas(val);
                }
              }}
              onBlur={(e) => {
                // On blur, ensure minimum if value is set
                const val = e.target.value;
                if (val && parseFloat(val) < 1) {
                  setMaxPriorityFeePerGas('1');
                }
              }}
              placeholder="Auto"
              min="1"
              step="0.1"
            />
          </div>
          <div className="gas-input-group">
            <label>Gas Limit - Minimum: 100,000</label>
            <input
              type="number"
              value={gasLimit}
              onChange={(e) => {
                const val = e.target.value;
                // Allow empty string for clearing, or values >= 100000
                if (val === '' || (!isNaN(parseInt(val)) && parseInt(val) >= 100000)) {
                  setGasLimit(val);
                }
              }}
              onBlur={(e) => {
                // On blur, ensure minimum if value is set
                const val = e.target.value;
                if (val && parseInt(val) < 100000) {
                  setGasLimit('100000');
                }
              }}
              placeholder="Auto"
              min="100000"
              step="1000"
            />
          </div>
          <button onClick={handleGetCurrentGas} className="get-current-gas">
            Use Current Network Gas Prices
          </button>
        </div>
      )}

      {estimating && <div className="estimating">Estimating gas costs...</div>}

      {gasEstimationDetails && (
        <div className="gas-estimation-explanation">
          <h4>Gas Limit Estimation</h4>
          <div className="estimation-details">
            <p><strong>Raw Estimate:</strong> {gasEstimationDetails.rawEstimate.toString()} gas</p>
            <p><strong>Buffer Applied:</strong> +{gasEstimationDetails.bufferAmount.toString()} gas</p>
            <p><strong>Final Gas Limit:</strong> {gasEstimationDetails.finalGasLimit.toString()} gas</p>
            <p className="explanation-text">
              We estimate the gas needed for your transaction, then add 100,000 gas as a buffer to ensure 
              the transaction doesn't fail due to gas estimation inaccuracies. The final gas limit is always at least 100,000.
            </p>
          </div>
        </div>
      )}

      {estimatedCost && (
        <div className="gas-estimate">
          <h4>Estimated Transaction Cost</h4>
          <div className="estimate-details">
            <p><strong>Gas Limit:</strong> {estimatedCost.gasLimit.toString()}</p>
            <p><strong>Gas Price:</strong> {ethers.formatUnits(estimatedCost.gasPrice, 'gwei')} Gwei</p>
            <p><strong>Total Cost:</strong> {estimatedCost.formatted} {currentChain?.nativeCurrency?.symbol || 'ETH'}</p>
          </div>
        </div>
      )}

      {balanceCheck && (
        <div className={`balance-check ${balanceCheck.isSufficient ? 'sufficient' : 'insufficient'}`}>
          {balanceCheck.isSufficient ? (
            <p className="success">✓ Sufficient balance</p>
          ) : (
            <div className="insufficient-balance">
              <p className="error">✗ Insufficient balance</p>
              <p>You need {balanceCheck.shortfallFormatted} {currentChain?.nativeCurrency?.symbol || 'ETH'} more</p>
              <p>Current: {balanceCheck.currentBalance} | Required: {balanceCheck.estimatedCost}</p>
            </div>
          )}
        </div>
      )}

      {warning && <div className="warning">{warning}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
