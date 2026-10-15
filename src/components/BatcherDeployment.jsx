import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { ensureDelegateDeployed, predictDelegateAddress } from '../utils/rescueTx';
import { BatcherDeploymentModal } from './BatcherDeploymentModal';

export function BatcherDeployment() {
  const { rescueWallet, provider, currentChain, setBatcherAddress, batcherContract } = useApp();
  const [deploying, setDeploying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [isDeployed, setIsDeployed] = useState(null);
  const [error, setError] = useState(null);
  const [deploymentInfo, setDeploymentInfo] = useState(null);

  // The delegate address depends only on the gas payer, so it is the same on every chain.
  const delegateAddress = rescueWallet ? predictDelegateAddress(rescueWallet.address) : null;

  // Reuse the delegate automatically when it already exists on this chain.
  useEffect(() => {
    if (!provider || !delegateAddress) return;
    let cancelled = false;
    setChecking(true);
    setError(null);
    provider
      .getCode(delegateAddress)
      .then((code) => {
        if (cancelled) return;
        const deployed = code !== '0x';
        setIsDeployed(deployed);
        if (deployed) setBatcherAddress(delegateAddress);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [provider, delegateAddress, setBatcherAddress]);

  const handleDeploy = async () => {
    if (!rescueWallet?.wallet) {
      setError('Rescue wallet not set. Please set up the rescue wallet first.');
      return;
    }
    setDeploying(true);
    setError(null);
    try {
      const { address, txHash } = await ensureDelegateDeployed(rescueWallet.wallet);
      setIsDeployed(true);
      setBatcherAddress(address);
      if (txHash) {
        setDeploymentInfo({
          address,
          chainName: currentChain?.name || `Chain ${currentChain?.chainId}`,
          chainId: currentChain?.chainId,
          txHash
        });
      }
    } catch (err) {
      console.error('[BatcherDeployment] Deployment error:', err);
      setError(err.shortMessage || err.message || 'Deployment failed. Please try again.');
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="batcher-deployment">
      <h3>Rescue Delegate</h3>
      <p>
        The compromised wallet delegates to this contract for one transaction. Only your rescue
        wallet can run batches through it, so the attacker's copy of the compromised key cannot use it.
      </p>

      {delegateAddress && (
        <p>
          <strong>Delegate address:</strong> <code>{delegateAddress}</code>
        </p>
      )}

      {checking && <div className="status">Checking whether the delegate is deployed...</div>}

      {batcherContract && isDeployed && (
        <div className="batcher-active">
          <p>Delegate is deployed on {currentChain?.name} and ready.</p>
        </div>
      )}

      {isDeployed === false && !checking && (
        <div className="deployment-options">
          <div className="option">
            <h4>Deploy Rescue Delegate</h4>
            <p className="info">
              One-time deployment on this chain, paid by the rescue wallet. The address is fixed for
              your rescue wallet, so later rescues from the same rescue wallet reuse it.
            </p>
            <button onClick={handleDeploy} disabled={deploying}>
              {deploying ? 'Deploying...' : 'Deploy Rescue Delegate'}
            </button>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {deploymentInfo && (
        <BatcherDeploymentModal
          address={deploymentInfo.address}
          chainName={deploymentInfo.chainName}
          chainId={deploymentInfo.chainId}
          txHash={deploymentInfo.txHash}
          onClose={() => setDeploymentInfo(null)}
        />
      )}
    </div>
  );
}
