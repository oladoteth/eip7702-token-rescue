import { useState, useEffect, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { checkBalanceSufficient, getWalletBalance } from '../utils/balanceChecker';
import { buildRescueTx, estimateRescueGas } from '../utils/rescueTx';
import { executeWithRetry } from '../utils/providerUtils';
import { ethers } from 'ethers';

// Minimum gas settings constants
const MIN_MAX_FEE_PER_GAS = ethers.parseUnits('1', 'gwei'); // 1 gwei minimum
const MIN_MAX_PRIORITY_FEE_PER_GAS = ethers.parseUnits('1', 'gwei'); // 1 gwei minimum
const MIN_GAS_LIMIT = 100000n; // 100,000 minimum

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

  // Estimates are async and overlap when the batch changes quickly. Only the newest one
  // may apply its result, or a stale failure can clear settings for a valid batch.
  const latestEstimateRef = useRef(0);

  // Simulates the real type-4 rescue tx, including the authorization, so the estimate
  // covers the delegated execution. Throws a readable error if the batch would revert.
  const estimateBatchGasLimit = async () => {
    const tx = await buildRescueTx({
      compromised: compromisedWallet.wallet,
      delegateAddress: batcherContract.address,
      calls: batchCalls
    });
    return estimateRescueGas(provider, tx, rescueWallet.address);
  };

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
              const { gasLimit: estimated } = await estimateBatchGasLimit();
              setGasLimit(estimated.toString());
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
  }, [batchCalls, rescueWallet?.address, compromisedWallet?.address, batcherContract?.address, gasMode, maxFeePerGas, maxPriorityFeePerGas, gasLimit, provider]);

  const estimateGas = async () => {
    const estimateId = ++latestEstimateRef.current;
    const isStale = () => estimateId !== latestEstimateRef.current;

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
      if (isStale()) return;

      // Ensure minimums
      const safeMaxFeePerGas = feeData.maxFeePerGas >= MIN_MAX_FEE_PER_GAS 
        ? feeData.maxFeePerGas 
        : MIN_MAX_FEE_PER_GAS;
      const safeMaxPriorityFeePerGas = feeData.maxPriorityFeePerGas >= MIN_MAX_PRIORITY_FEE_PER_GAS
        ? feeData.maxPriorityFeePerGas
        : MIN_MAX_PRIORITY_FEE_PER_GAS;

      // A failed simulation means the batch would revert on-chain, so stop here
      // instead of falling back to a guessed gas limit.
      const { estimate: rawEstimate, gasLimit: estimatedGasLimit } = await estimateBatchGasLimit();
      if (isStale()) return;

      setGasEstimationDetails({
        rawEstimate,
        bufferAmount: estimatedGasLimit - rawEstimate,
        finalGasLimit: estimatedGasLimit
      });

      // Determine final gas values based on mode
      let finalMaxFeePerGas, finalMaxPriorityFeePerGas, finalGasLimit;
      if (gasMode === 'automatic') {
        finalMaxFeePerGas = safeMaxFeePerGas;
        finalMaxPriorityFeePerGas = safeMaxPriorityFeePerGas;
        finalGasLimit = estimatedGasLimit;
      } else {
        // Use custom values with minimums enforced
        finalMaxFeePerGas = maxFeePerGas 
          ? ethers.parseUnits(Math.max(parseFloat(maxFeePerGas), 1).toString(), 'gwei')
          : safeMaxFeePerGas;
        finalMaxPriorityFeePerGas = maxPriorityFeePerGas
          ? ethers.parseUnits(Math.max(parseFloat(maxPriorityFeePerGas), 1).toString(), 'gwei')
          : safeMaxPriorityFeePerGas;
        finalGasLimit = gasLimit 
          ? BigInt(Math.max(parseInt(gasLimit), Number(MIN_GAS_LIMIT)))
          : estimatedGasLimit;
      }

      // Worst-case cost: the payer must hold gasLimit * maxFeePerGas for the tx to be accepted.
      const totalCost = finalGasLimit * finalMaxFeePerGas;
      setEstimatedCost({
        gasLimit: finalGasLimit,
        gasPrice: finalMaxFeePerGas,
        totalCost,
        formatted: ethers.formatEther(totalCost)
      });

      // The rescue wallet only pays gas. Call values come from the compromised wallet.
      const balanceInfo = await getWalletBalance(provider, rescueWallet.address);
      if (isStale()) return;
      const check = checkBalanceSufficient(balanceInfo.balance, totalCost);
      setBalanceCheck(check);

      if (!check.isSufficient) {
        setWarning(
          `⚠️ Insufficient balance! You need ${check.shortfallFormatted} ${currentChain?.nativeCurrency?.symbol || 'ETH'} more. ` +
          `Current: ${check.currentBalance}, Required: ${check.estimatedCost}. Please fund your rescue wallet.`
        );
      }

      if (onGasSettingsReady) {
        onGasSettingsReady({
          mode: gasMode,
          maxFeePerGas: finalMaxFeePerGas,
          maxPriorityFeePerGas: finalMaxPriorityFeePerGas,
          gasLimit: finalGasLimit,
          estimatedCost: totalCost
        });
      }
    } catch (err) {
      if (isStale()) return;
      setError(err.message);
      onGasSettingsReady?.(null);
      console.error('Gas estimation error:', err);
    } finally {
      if (!isStale()) setEstimating(false);
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
                    const { gasLimit: estimated } = await estimateBatchGasLimit();
                    setGasLimit(estimated.toString());
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
              We simulate the full rescue transaction, including the delegation, then add a 25% buffer
              so small differences between simulation and execution do not make it run out of gas.
            </p>
          </div>
        </div>
      )}

      {estimatedCost && (
        <div className="gas-estimate">
          <h4>Estimated Transaction Cost</h4>
          <div className="estimate-details">
            <p><strong>Gas Limit:</strong> {estimatedCost.gasLimit.toString()}</p>
            <p><strong>Max Fee Per Gas:</strong> {ethers.formatUnits(estimatedCost.gasPrice, 'gwei')} Gwei</p>
            <p><strong>Max Total Cost:</strong> {estimatedCost.formatted} {currentChain?.nativeCurrency?.symbol || 'ETH'}</p>
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
