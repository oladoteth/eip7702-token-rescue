import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../contexts/AppContext';
import { executeWithRetry } from '../utils/providerUtils';

export function TransactionStatusModal({ txHash, onClose }) {
  const { provider, currentChain } = useApp();
  const [status, setStatus] = useState(null); // 'success' or 'failed'
  const [mounted, setMounted] = useState(false);
  const [checking, setChecking] = useState(true);

  // Creator info - Update these with your actual details
  const creatorTwitter = '@oladoteth'; // Replace with actual Twitter handle
  const toolName = 'Token Rescue Tool';
  const creatorDM = 'https://x.com/oladoteth'; // Replace with actual Twitter DM link

  // Ensure component is mounted before rendering portal
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Lock body scroll when modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  useEffect(() => {
    if (!txHash || !provider) {
      return;
    }

    checkTransactionStatus();
  }, [txHash, provider]);

  const checkTransactionStatus = async () => {
    if (!provider || !txHash) {
      return;
    }

    try {
      setChecking(true);
      
      // Wait for transaction to be mined with retry logic
      const receipt = await executeWithRetry(
        provider,
        async (p) => {
          // First check if already mined
          let receipt = await p.getTransactionReceipt(txHash);
          if (receipt) {
            return receipt;
          }
          
          // Wait for transaction (up to 2 minutes)
          return await p.waitForTransaction(txHash, 1, 120000);
        },
        3
      );

      if (receipt) {
        if (receipt.status === 1) {
          setStatus('success');
          setConfirmations(receipt.confirmations || 0);
        } else {
          setStatus('failed');
          setError('Transaction reverted');
        }
      } else {
        setStatus('failed');
        setError('Transaction not found or timed out');
      }
    } catch (err) {
      console.error('Error checking transaction:', err);
      setStatus('failed');
      setError(err.message || 'Unable to verify transaction status. Please check the explorer.');
    } finally {
      setChecking(false);
    }
  };

  const handleTweet = () => {
    const tweetText = `Just used ${toolName}! An amazing tool for recovering assets from compromised wallets.Thanks to ${creatorTwitter} for creating this tool.`;
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&hashtags=Web3,Crypto,TokenRescue`;
    window.open(tweetUrl, '_blank');
  };

  const handleDM = () => {
    window.open(creatorDM, '_blank');
  };

  if (!txHash || !mounted) return null;

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

        {checking && (
          <div className="modal-status checking">
            <h2>Checking Transaction...</h2>
            <p>Please wait while we verify your transaction status.</p>
            <div className="tx-hash-display">
              <code>{txHash}</code>
              <a
                href={`${currentChain?.explorer}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="explorer-link"
              >
                View on Explorer →
              </a>
            </div>
          </div>
        )}

        {!checking && status === 'success' && (
          <div className="modal-status">
            <h2>Transaction Submitted Successfully!</h2>
            <p className="success-message">
              Your rescue transaction has been submitted successfully on the blockchain. 
              Please check the explorer to see the transaction status.
            </p>
            <div className="tx-hash-display">
              <code>{txHash}</code>
              <a
                href={`${currentChain?.explorer}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="explorer-link"
              >
                View on Explorer →
              </a>
            </div>

            <div className="social-prompt">
              <h3>Share Your Story! 🚀</h3>
              <p>
                Help others discover this tool by sharing your experience on Twitter. 
                Your story could help someone else rescue their assets!
              </p>
              <button onClick={handleTweet} className="tweet-button">
                <span>🐦</span>
                Tweet About It
              </button>
            </div>
          </div>
        )}

        {!checking && status === 'failed' && (
          <div className="modal-status failed">
            <h2>Transaction Failed</h2>
            <p className="error-message">
              Unfortunately, your transaction did not complete successfully.
            </p>
            <div className="tx-hash-display">
              <code>{txHash}</code>
              <a
                href={`${currentChain?.explorer}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="explorer-link"
              >
                View on Explorer →
              </a>
            </div>

            <div className="support-prompt">
              <h3>Need Help? 💬</h3>
              <p>
                We're here to help! Please send us a private message with the transaction hash 
                and details about what happened. This helps us improve the tool and assist you better.
              </p>
              <button onClick={handleDM} className="dm-button">
                <span>💬</span>
                Send a Message
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Render modal at body level using portal
  return createPortal(modalContent, document.body);
}
