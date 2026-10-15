import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { ethers } from 'ethers';

export function DonateTab() {
  const { connectedWallet, currentChain } = useApp();
  const [copied, setCopied] = useState(false);
  
  // Developer wallet address - replace with your actual address
  const developerAddress = '0x16db1b19a87DA38B5434477480D3608857609423';
  const donationPercentage = '15%';

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(developerAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDonate = async () => {
    if (!connectedWallet) {
      alert('Please setup your rescue wallet first to make a donation.');
      return;
    }
    if (!connectedWallet.signer) {
      alert('Wallet signer not available. Please setup rescue wallet.');
      return;
    }

    try {
      // Prompt for amount
      const amount = prompt('Enter donation amount in ETH:', '0.01');
      if (amount && connectedWallet.signer) {
        const signer = connectedWallet.signer;
        
        // Send transaction
        const tx = await signer.sendTransaction({
          to: developerAddress,
          value: ethers.parseEther(amount)
        });
        
        alert(`Donation sent! Transaction: ${tx.hash}`);
      }
    } catch (error) {
      console.error('Donation error:', error);
      alert('Donation failed. Please try again.');
    }
  };

  return (
    <div className="donate-tab">
      <div className="donate-hero">
        <div className="coffee-icon">☕</div>
        <h2>Buy a Coffee for the Developer</h2>
        <p className="hero-subtitle">
          Support the development of this open-source rescue tool
        </p>
      </div>

      <div className="donate-content">
        <div className="donate-card">
          <div className="donate-section">
            <h3>Why Donate?</h3>
            <p className="donate-text">
              Building and maintaining tools like this takes countless hours of development, 
              testing, and refinement. Your support helps keep this project alive and enables 
              continuous improvements to help more people rescue their assets.
            </p>
            <p className="donate-text">
              Every donation, no matter how small, makes a difference. It shows appreciation 
              for the work and helps cover infrastructure costs, security audits, and ongoing 
              development time.
            </p>
          </div>

          <div className="donate-section impact-section">
            <div className="impact-icon">🌱</div>
            <h3>Making an Impact Together</h3>
            <p className="donate-text highlight">
              <strong>{donationPercentage} of all donations</strong> are automatically allocated 
              to charitable initiatives focused on fostering technology education in underserved 
              communities and groups around the world.
            </p>
            <p className="donate-text">
              By supporting this project, you're not just helping developers—you're contributing 
              to a mission that brings coding skills, blockchain knowledge, and digital literacy 
              to those who need it most. Together, we're building a more inclusive tech ecosystem 
              where opportunities for learning and growth are accessible to everyone, regardless 
              of their background or circumstances.
            </p>
            <p className="donate-text">
              Your generosity creates a ripple effect: supporting open-source development while 
              simultaneously empowering the next generation of builders, creators, and innovators 
              in communities that have historically been left behind in the tech revolution.
            </p>
          </div>

          <div className="donate-section address-section">
            <h3>Developer Wallet Address</h3>
            <div className="address-container">
              <code className="wallet-address">{developerAddress}</code>
              <button 
                onClick={handleCopyAddress}
                className="copy-button"
                title="Copy address"
              >
                {copied ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>
            <p className="address-note">
              Send any amount of ETH or native token to this address. 
              {donationPercentage} will go to tech education charities.
            </p>
          </div>

          <div className="donate-actions">
            {connectedWallet ? (
              <button onClick={handleDonate} className="donate-button">
                <span>💝</span>
                Donate via Wallet
              </button>
            ) : (
              <div className="connect-prompt">
                <p>Setup your rescue wallet to donate directly, or send manually to the address above.</p>
              </div>
            )}
          </div>

          <div className="donate-footer">
            <p className="thank-you">
              <span className="heart">❤️</span>
              Thank you for your support!
            </p>
            <p className="transparency">
              All donations are transparent on-chain. The charitable portion is distributed 
              quarterly to verified organizations focused on tech education.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
