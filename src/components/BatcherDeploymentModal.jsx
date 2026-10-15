import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getNetworkByChainId } from '../utils/networks';

export function BatcherDeploymentModal({ address, chainName, chainId, txHash, onClose }) {
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  const network = getNetworkByChainId(chainId);
  const explorerUrl = network?.explorer ? `${network.explorer}/tx/${txHash}` : null;

  // Ensure component is mounted before rendering portal
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Lock body scroll when modal is open
  useEffect(() => {
    // Save original overflow style
    const originalOverflow = document.body.style.overflow;
    // Lock scroll
    document.body.style.overflow = 'hidden';
    
    return () => {
      // Restore original overflow on unmount
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  const handleCopyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };



  const modalContent = (
    <div 
      className="modal-overlay" 
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
    >
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} title="Close">×</button>
        
        <div className="modal-status">
          <h2>Batcher Contract Deployed Successfully on {chainName}!</h2>
          
          <div className="deployment-info">
            <div className="info-item">
              <strong>Contract Address:</strong>
              <div className="address-container">
                <code className="contract-address">{address}</code>
                <button 
                  onClick={handleCopyAddress}
                  className="copy-button"
                  title="Copy address"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            
            {txHash && (
              <div className="info-item">
                <strong>Transaction Hash:</strong>
                <div className="address-container">
                  <code className="tx-hash">{txHash}</code>
                  {explorerUrl && (
                    <a 
                      href={explorerUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="explorer-link"
                    >
                      View on Explorer →
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // Render modal at body level using portal
  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}
