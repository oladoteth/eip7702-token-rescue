/**
 * EIP-6963 injected wallet discovery and the few EIP-1193 calls the safe wallet needs.
 * Injected wallets are used only to read an address and to send a plain funding transfer.
 * They cannot sign EIP-7702 authorizations for our delegate or send type-4 transactions.
 */

import { useEffect, useState } from 'react';
import { ethers } from 'ethers';

/**
 * Lists wallets that announce themselves through EIP-6963.
 * @returns {Array<{info: {uuid: string, name: string, icon: string, rdns: string}, provider: object}>}
 */
export function useInjectedWallets() {
  const [wallets, setWallets] = useState([]);

  useEffect(() => {
    const onAnnounce = (event) => {
      const { info, provider } = event.detail || {};
      if (!info?.uuid || !provider) return;
      setWallets((prev) => (prev.some((w) => w.info.uuid === info.uuid) ? prev : [...prev, { info, provider }]));
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);

  return wallets;
}

/**
 * Asks the wallet for access and returns the selected account.
 * @param {object} eip1193 - EIP-1193 provider
 * @returns {Promise<string>} Checksummed address
 */
export async function requestAccount(eip1193) {
  const accounts = await eip1193.request({ method: 'eth_requestAccounts' });
  if (!accounts?.length) {
    throw new Error('The wallet returned no accounts');
  }
  return ethers.getAddress(accounts[0]);
}

/**
 * Sends a plain native-coin transfer from a connected wallet, switching it to `chainId` first.
 * @param {object} eip1193 - EIP-1193 provider
 * @param {number} chainId - Chain the app is using
 * @param {string} to - Recipient (the rescue wallet)
 * @param {bigint} value - Amount in wei
 * @returns {Promise<ethers.TransactionResponse>}
 */
export async function sendFromInjected(eip1193, chainId, to, value) {
  const browserProvider = new ethers.BrowserProvider(eip1193);
  const { chainId: walletChainId } = await browserProvider.getNetwork();
  if (Number(walletChainId) !== chainId) {
    try {
      await eip1193.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ethers.toQuantity(chainId) }]
      });
    } catch (error) {
      throw new Error(`Switch your wallet to chain ${chainId} and try again. (${error.message})`);
    }
  }
  // A fresh BrowserProvider so ethers does not keep the pre-switch network.
  const signer = await new ethers.BrowserProvider(eip1193).getSigner();
  return signer.sendTransaction({ to, value });
}
