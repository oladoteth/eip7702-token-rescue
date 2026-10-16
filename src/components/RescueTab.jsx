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
import { ApprovalScanner } from "./ApprovalScanner";
import { NativeSweep } from "./NativeSweep";
import { PositionScanner } from "./PositionScanner";
import { BatchTransactionViewer } from "./BatchTransactionViewer";
import { BatcherDeployment } from "./BatcherDeployment";
import { GasSettings } from "./GasSettings";
import { RescueExecutor } from "./RescueExecutor";

export function RescueTab() {
  const { rescueWallet, safeWallet, compromisedWallet, batchCalls, batcherContract, currentChain: selectedChain, rpcStatus } =
    useApp();
  // Every step past chain selection needs an RPC that really simulates EIP-7702.
  const currentChain = rpcStatus?.eip7702?.supported ? selectedChain : null;
  const [gasSettings, setGasSettings] = useState(null);

  // Reset gas settings when the batch or the delegate changes, so they are recalculated
  useEffect(() => {
    setGasSettings(null);
  }, [batchCalls, batcherContract?.address]);

  // Each step appears once the one before it is done: chain (with a passing EIP-7702
  // check), rescue wallet, safe wallet, compromised wallet, delegate, batch, gas, execute.

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

      {/* Step 4: Deploy/Set Rescue Delegate - Visible when compromised wallet is set */}
      {currentChain && rescueWallet && safeWallet && compromisedWallet && (
        <section className="batcher-section">
          <BatcherDeployment />
        </section>
      )}

      {/* Step 5: Load Contracts - Visible when the delegate is deployed */}
      {currentChain && rescueWallet && safeWallet && compromisedWallet && batcherContract && (
        <section className="contract-section">
          <EnhancedContractLoader />
        </section>
      )}

      {/* Step 6: Build Batch Transactions - Visible when the delegate is deployed */}
      {currentChain && rescueWallet && safeWallet && compromisedWallet && batcherContract && (
        <section className="batch-section">
          <ApprovalScanner />
          <AssetScanner />
          <PositionScanner />
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

      {/* Step 8: Configure Gas - Visible when batch calls exist and the delegate is deployed */}
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
              You'll need to re-enter the compromised wallet and rebuild the batch.
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
            <h3>6. Choose What to Rescue</h3>
            <p>
              Revoke the wallet's approvals, scan it for tokens and NFTs, scan Lido, Aave and
              Uniswap positions, add the native coin sweep, or add custom calls for anything else.
            </p>
          </div>
          <div className="step">
            <h3>7. Review and Set Gas</h3>
            <p>
              Every call is checked against your safe wallet before sending. The whole batch is
              simulated, including the delegation, to set the gas limit.
            </p>
          </div>
          <div className="step">
            <h3>8. Execute the Rescue</h3>
            <p>
              One EIP-7702 transaction: the compromised wallet delegates to the rescue delegate,
              and the rescue wallet pays the gas to run the whole batch. If any call fails,
              nothing moves.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
