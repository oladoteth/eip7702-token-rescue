import { useState, useEffect } from "react";
import { useApp } from "../contexts/AppContext";
import { ChainSelector } from "./ChainSelector";
import { RescueWalletInput } from "./RescueWalletInput";
import { CompromisedWalletInput } from "./CompromisedWalletInput";
import { SafeWalletInput } from "./SafeWalletInput";
import { EnhancedContractLoader } from "./EnhancedContractLoader";
import { InteractiveBatchBuilder } from "./InteractiveBatchBuilder";
import { TokenSweepInput } from "./TokenSweepInput";
import { AssetScanner } from "./AssetScanner";
import { NativeSweep } from "./NativeSweep";
import { BatchTransactionViewer } from "./BatchTransactionViewer";
import { BatcherDeployment } from "./BatcherDeployment";
import { GasSettings } from "./GasSettings";
import { RescueExecutor } from "./RescueExecutor";

export function RescueTab() {
  const { rescueWallet, safeWallet, compromisedWallet, batchCalls, batcherContract, currentChain } =
    useApp();
  const [gasSettings, setGasSettings] = useState(null);

  // Reset gas settings when batch calls or batcher contract changes
  // This ensures gas settings are recalculated when dependencies change
  useEffect(() => {
    setGasSettings(null);
  }, [batchCalls, batcherContract?.address]);

  // Step-by-step flow enforcement
  // Step 1: Select chain (always visible)
  // Step 2: Setup rescue wallet (visible when chain selected)
  // Step 3: Enter compromised wallet (visible when rescue wallet set)
  // Step 4: Deploy/set batcher (visible when compromised wallet set)
  // Step 5: Load contracts (visible when batcher set)
  // Step 6: Build batch (visible when batcher set)
  // Step 7: Review & gas (visible when batch calls exist and batcher set)
  // Step 8: Execute (visible when gas settings ready)

  return (
    <>
      {/* Step 1: Select Chain - Always visible */}
      <section className="chain-section">
        <ChainSelector />
      </section>

      {/* Step 2: Setup Rescue Wallet - Visible when chain selected */}
      {currentChain && (
        <section className="rescue-wallet-section">
          <RescueWalletInput />
        </section>
      )}

      {/* Step 3: Set up Safe Wallet - Visible when rescue wallet is set */}
      {currentChain && rescueWallet && (
        <section className="safe-wallet-section">
          <SafeWalletInput />
        </section>
      )}

      {/* Step 4: Enter Compromised Wallet - Visible when safe wallet is set */}
      {currentChain && rescueWallet && safeWallet && (
        <section className="wallet-section">
          <CompromisedWalletInput />
        </section>
      )}

      {/* Step 4: Deploy/Set Batcher Contract - Visible when compromised wallet is set */}
      {currentChain && rescueWallet && safeWallet && compromisedWallet && (
        <section className="batcher-section">
          <BatcherDeployment />
        </section>
      )}

      {/* Step 5: Load Contracts - Visible when batcher contract is set */}
      {currentChain && rescueWallet && safeWallet && compromisedWallet && batcherContract && (
        <section className="contract-section">
          <EnhancedContractLoader />
        </section>
      )}

      {/* Step 6: Build Batch Transactions - Visible when batcher contract is set */}
      {currentChain && rescueWallet && safeWallet && compromisedWallet && batcherContract && (
        <section className="batch-section">
          <AssetScanner />
          <NativeSweep />
          <TokenSweepInput />
          <InteractiveBatchBuilder />
        </section>
      )}

      {/* Step 7: Review Batch Transactions - Visible when batch calls exist */}
      {currentChain && rescueWallet && safeWallet && compromisedWallet && batcherContract && batchCalls.length > 0 && (
        <section className="viewer-section">
          <BatchTransactionViewer />
        </section>
      )}

      {/* Step 8: Configure Gas - Visible when batch calls exist and batcher contract is set */}
      {currentChain && rescueWallet && safeWallet && compromisedWallet && batcherContract && batchCalls.length > 0 && (
        <section className="gas-section">
          <GasSettings onGasSettingsReady={setGasSettings} />
        </section>
      )}

      {/* Step 9: Execute Rescue - Visible when gas settings are ready */}
      {currentChain && rescueWallet && safeWallet && compromisedWallet && batcherContract && batchCalls.length > 0 && gasSettings && (
        <section className="executor-section">
          <RescueExecutor gasSettings={gasSettings} />
        </section>
      )}

      {/* Info Section - Always visible */}
      <section className="info-section">
        <h2>How It Works</h2>
        <div className="steps">
          <div className="step">
            <h3>1. Select Chain</h3>
            <p>
              Choose the blockchain network for the rescue operation.
            </p>
            <p className="warning-text">
              <strong>⚠️ Important:</strong> Changing the network will reset the entire flow. 
              You'll need to re-enter the compromised wallet and set the batcher contract.
            </p>
          </div>
          <div className="step">
            <h3>2. Setup Rescue Wallet</h3>
            <p>
              Generate a new wallet or import an existing one using a private key. 
              This wallet will pay for all gas fees during the rescue operation.
            </p>
            <p className="warning-text">
              <strong>⚠️ Critical:</strong> Save your private key securely! You'll need it to use this wallet again.
            </p>
          </div>
          <div className="step">
            <h3>3. Set Up Safe Wallet</h3>
            <p>
              Choose where rescued assets go: connect a browser wallet, generate a new
              one, import a key, or reuse the rescue wallet.
            </p>
          </div>
          <div className="step">
            <h3>4. Enter Compromised Wallet</h3>
            <p>
              Enter the private key of the compromised wallet. This is
              processed locally only.
            </p>
          </div>
          <div className="step">
            <h3>5. Deploy Rescue Delegate</h3>
            <p>
              One-time deployment per chain. The address is fixed for your rescue
              wallet, so it is reused automatically.
            </p>
          </div>
          <div className="step">
            <h3>6. Load Contracts & ABIs</h3>
            <p>
              Load contracts and ABIs. View read/write functions or decode
              pasted transaction data.
            </p>
          </div>
          <div className="step">
            <h3>7. Build Batch Transactions</h3>
            <p>
              Build transactions interactively or decode and add pasted
              transaction data.
            </p>
          </div>
          <div className="step">
            <h3>8. Review & Configure Gas</h3>
            <p>
              Review transaction order, configure gas settings, and check balance
              sufficiency.
            </p>
          </div>
          <div className="step">
            <h3>9. Execute Rescue</h3>
            <p>
              One EIP-7702 transaction: the compromised wallet delegates to the rescue
              delegate, and the rescue wallet pays the gas to run the whole batch.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
