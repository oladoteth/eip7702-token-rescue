import { useState, useEffect, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { deployBatcherContract, verifyBatcherContract } from '../utils/contractDeployment';
import { compileSolidity, replaceAddressInSolidity } from '../utils/solidityCompiler';
import { BatcherDeploymentModal } from './BatcherDeploymentModal';

// Hardcoded Solidity contract template
// {{MASTER_ADDRESS}} will be replaced with the connected wallet address BEFORE compilation
// This happens in JavaScript, so the Solidity compiler sees the actual address
const BATCHER_CONTRACT_SOLIDITY = `// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.5.0) (utils/ReentrancyGuard.sol)
pragma solidity ^0.8.24;

// OpenZeppelin StorageSlot (master branch)
// Source: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/utils/StorageSlot.sol
library StorageSlot {
    struct AddressSlot {
        address value;
    }

    struct BooleanSlot {
        bool value;
    }

    struct Bytes32Slot {
        bytes32 value;
    }

    struct Uint256Slot {
        uint256 value;
    }

    struct StringSlot {
        string value;
    }

    struct BytesSlot {
        bytes value;
    }

    function getAddressSlot(bytes32 slot) internal pure returns (AddressSlot storage r) {
        assembly {
            r.slot := slot
        }
    }

    function getBooleanSlot(bytes32 slot) internal pure returns (BooleanSlot storage r) {
        assembly {
            r.slot := slot
        }
    }

    function getBytes32Slot(bytes32 slot) internal pure returns (Bytes32Slot storage r) {
        assembly {
            r.slot := slot
        }
    }

    function getUint256Slot(bytes32 slot) internal pure returns (Uint256Slot storage r) {
        assembly {
            r.slot := slot
        }
    }

    function getStringSlot(bytes32 slot) internal pure returns (StringSlot storage r) {
        assembly {
            r.slot := slot
        }
    }

    function getStringSlot(string storage store) internal pure returns (StringSlot storage r) {
        assembly {
            r.slot := store.slot
        }
    }

    function getBytesSlot(bytes storage store) internal pure returns (BytesSlot storage r) {
        assembly {
            r.slot := store.slot
        }
    }
}

// OpenZeppelin ReentrancyGuard (master branch)
// Source: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/utils/ReentrancyGuard.sol
abstract contract ReentrancyGuard {
    using StorageSlot for bytes32;

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ReentrancyGuard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant REENTRANCY_GUARD_STORAGE =
        0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    error ReentrancyGuardReentrantCall();

    constructor() {
        _reentrancyGuardStorageSlot().getUint256Slot().value = NOT_ENTERED;
    }

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    modifier nonReentrantView() {
        _nonReentrantBeforeView();
        _;
    }

    function _nonReentrantBeforeView() private view {
        if (_reentrancyGuardEntered()) {
            revert ReentrancyGuardReentrantCall();
        }
    }

    function _nonReentrantBefore() private {
        _nonReentrantBeforeView();
        _reentrancyGuardStorageSlot().getUint256Slot().value = ENTERED;
    }

    function _nonReentrantAfter() private {
        _reentrancyGuardStorageSlot().getUint256Slot().value = NOT_ENTERED;
    }

    function _reentrancyGuardEntered() internal view returns (bool) {
        return _reentrancyGuardStorageSlot().getUint256Slot().value == ENTERED;
    }

    function _reentrancyGuardStorageSlot() internal pure virtual returns (bytes32) {
        return REENTRANCY_GUARD_STORAGE;
    }
}

contract simpleBatch is ReentrancyGuard {
    address private immutable controlAddress = address({{MASTER_ADDRESS}}); // Supreme controller of all wallet delegated to this contract

    constructor() {}

    event CallExecuted(address target, bytes data, bool success);

    modifier onlyController() {
        require(
            msg.sender == controlAddress,
            "Only controller can call this function"
        );
        _;
    }

    function getController() public view returns (address) {
        return controlAddress;
    }

    function batchExecuteCalls(
        address[] calldata targets,
        bytes[] calldata datas,
        uint256[] calldata values
    ) public payable onlyController nonReentrant {
        require(targets.length == datas.length, "Arrays length mismatch");
        require(targets.length == values.length, "Values array length mismatch");
        require(targets.length > 0, "Empty arrays");
        require(targets.length <= 50, "Too many calls");

        for (uint256 i = 0; i < targets.length; i++) {
            require(targets[i] != address(0), "Invalid target address");
            require(targets[i] != address(this), "Cannot call self");
            (bool success, ) = targets[i].call{value: values[i]}(datas[i]);
            emit CallExecuted(targets[i], datas[i], success);
        }
    }
}`;

const CONTRACT_NAME = 'simpleBatch';

export function BatcherDeployment() {
  const { rescueWallet, compromisedWallet, provider, currentChain, setBatcherAddress, batcherContract, selectedChainId } = useApp();
  const [batcherAddressInput, setBatcherAddressInput] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [showDeploymentModal, setShowDeploymentModal] = useState(false);
  const [deploymentInfo, setDeploymentInfo] = useState(null);
  const deploymentInProgressRef = useRef(false);
  const submittedTxHashRef = useRef(null);
  const prevChainIdRef = useRef(selectedChainId);

  // Reset state when network changes
  useEffect(() => {
    const currentChainId = selectedChainId;
    if (prevChainIdRef.current !== currentChainId && currentChainId) {
      console.log('[BatcherDeployment] Network changed, resetting state');
      setDeploying(false);
      setCompiling(false);
      setError(null);
      setStatus(null);
      setShowDeploymentModal(false);
      setDeploymentInfo(null);
      deploymentInProgressRef.current = false;
      submittedTxHashRef.current = null;
      setBatcherAddressInput('');
      prevChainIdRef.current = currentChainId;
    }
  }, [selectedChainId]);

  // Clear status when batcher contract is successfully set (after a delay)
  useEffect(() => {
    if (batcherContract && status && (status.includes('Using contract:') || status.includes('Contract deployed successfully!'))) {
      // Clear status after 3 seconds when contract is successfully set
      const timer = setTimeout(() => {
        setStatus(null);
        setError(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [batcherContract, status]);

  // Clear status when user clicks "Change" to reset batcher
  const handleChangeBatcher = () => {
    setBatcherAddress(null);
    setStatus(null);
    setError(null);
    setShowDeploymentModal(false);
    setDeploymentInfo(null);
    setBatcherAddressInput('');
  };

  const handleDeploy = async () => {
    if (!rescueWallet) {
      setError('Rescue wallet not set. Please setup rescue wallet first.');
      return;
    }

    if (!compromisedWallet) {
      setError('Compromised wallet not set. Please enter compromised wallet first.');
      return;
    }

    if (!currentChain) {
      setError('No network selected');
      return;
    }

    if (!provider) {
      setError('Provider not available. Please select a chain.');
      return;
    }

    // Prevent multiple simultaneous deployments
    if (deploymentInProgressRef.current) {
      console.warn('[BatcherDeployment] Deployment already in progress');
      return;
    }

    // Check if we already have a submitted transaction
    if (submittedTxHashRef.current) {
      setError(`Transaction already submitted: ${submittedTxHashRef.current}. Please wait for confirmation or check the explorer.`);
      return;
    }

    deploymentInProgressRef.current = true;
    setDeploying(true);
    setCompiling(false);
    setError(null);
    setStatus(null); // Clear any previous status messages
    setShowDeploymentModal(false); // Close any open modals
    setDeploymentInfo(null); // Clear previous deployment info

    try {
      // Validate network
      if (!currentChain) {
        setError('No network selected');
        return;
      }

      // Use compromised wallet address as master address (controller)
      // The compromised wallet will be able to call the batcher contract
      const masterAddress = compromisedWallet.address;

      setCompiling(true);
      setStatus('Compiling contract...');

      try {
        // Replace placeholder with connected wallet address
        // This happens in JavaScript BEFORE Solidity compilation
        // The compiler will see: address(0x1234...) not address({{MASTER_ADDRESS}})
        const modifiedCode = replaceAddressInSolidity(
          BATCHER_CONTRACT_SOLIDITY,
          '{{MASTER_ADDRESS}}',
          masterAddress
        );

        // Log the replacement for debugging - show the line with the address
        const addressLine = modifiedCode.split('\n').find(line => line.includes('controlAddress'));
        if (addressLine) {
          console.log('Contract code after address replacement (controlAddress line):', addressLine.trim());
        }

        // Compile the contract (compiler sees the actual address, not placeholder)
        const compiled = await compileSolidity(modifiedCode, CONTRACT_NAME);
        const bytecodeToDeploy = '0x' + compiled.bytecode;
        
        setStatus('Compilation successful! Deploying contract...');
        setCompiling(false);

        // Deploy the contract using rescue wallet (pays for gas)
        if (!rescueWallet.wallet) {
          throw new Error('Rescue wallet not available.');
        }
        
        // Deploy and get transaction hash immediately
        const { ethers } = await import('ethers');
        const { BATCHER_CONTRACT_ABI } = await import('../utils/contractDeployment');
        const factory = new ethers.ContractFactory(
          BATCHER_CONTRACT_ABI,
          bytecodeToDeploy,
          rescueWallet.wallet
        );
        
        // Start deployment - this returns immediately with transaction hash
        const contract = await factory.deploy();
        const deploymentTx = contract.deploymentTransaction();
        
        if (!deploymentTx || !deploymentTx.hash) {
          throw new Error('Deployment transaction not found');
        }
        
        const txHash = deploymentTx.hash;
        submittedTxHashRef.current = txHash;
        console.log('[BatcherDeployment] Transaction submitted:', txHash);
        
        // Wait for deployment to complete before showing modal
        setStatus('Transaction submitted! Waiting for confirmation...');
        setError(null);
        
        // Wait for transaction with timeout
        const provider = rescueWallet.wallet.provider;
        let receipt;
        try {
          receipt = await provider.waitForTransaction(txHash, 1, 120000); // 2 minute timeout
        } catch (waitError) {
          console.warn('[BatcherDeployment] waitForTransaction failed, trying to get receipt directly:', waitError.message);
          // Try to get receipt directly
          for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
              receipt = await provider.getTransactionReceipt(txHash);
              if (receipt) break;
            } catch (err) {
              if (i === 9) {
                // Last attempt failed - transaction still pending
                console.warn('[BatcherDeployment] Could not get receipt, transaction still pending:', txHash);
                setStatus(`Transaction submitted! Hash: ${txHash}. Please check the explorer to get the contract address once confirmed.`);
                setError(null);
                return; // Don't show modal, just show status
              }
            }
          }
        }
        
        if (receipt && receipt.status === 1) {
          // Success! Get contract address
          let address = receipt.contractAddress;
          if (!address) {
            try {
              address = await contract.getAddress();
            } catch (addrError) {
              console.warn('[BatcherDeployment] Could not get address from contract:', addrError);
            }
          }
          
          if (address) {
            setBatcherAddress(address);
            setStatus(`Contract deployed successfully! Address: ${address}`);
            
            // Show modal with success state
            setDeploymentInfo({
              address: address,
              chainName: currentChain?.name || `Chain ${currentChain?.chainId}`,
              chainId: currentChain?.chainId,
              txHash: txHash
            });
            setShowDeploymentModal(true);
          } else {
            setStatus(`Transaction confirmed but address not available. Hash: ${txHash}`);
            setError('Could not determine contract address. Please check the explorer.');
          }
        } else if (receipt && receipt.status === 0) {
          // Transaction failed
          setError('Transaction reverted. Please check the explorer for details.');
          setStatus(null);
        } else {
          // Still pending after retries
          setStatus(`Transaction submitted! Hash: ${txHash}. Please check the explorer to get the contract address once confirmed.`);
        }
      } catch (compileError) {
        setError(`Compilation failed: ${compileError.message}`);
        throw compileError;
      }
    } catch (err) {
      console.error('[BatcherDeployment] Deployment error:', err);
      if (err.message?.includes('already in progress')) {
        setError('Deployment is already in progress. Please wait.');
      } else if (err.message?.includes('Network mismatch') || err.message?.includes('Network not stable')) {
        setError('Network changed during deployment. Please try again after the network stabilizes.');
        // Reset state on network error
        submittedTxHashRef.current = null;
      } else {
        setError(err.message || 'Deployment failed. Please try again.');
      }
      setStatus(null);
    } finally {
      setDeploying(false);
      setCompiling(false);
      deploymentInProgressRef.current = false;
    }
  };

  const handleUseAddress = async () => {
    if (!batcherAddressInput.trim()) {
      setError('Contract address is required');
      return;
    }

    setError(null);
    setStatus('Verifying contract...');
    setShowDeploymentModal(false); // Close any open modals
    setDeploymentInfo(null); // Clear previous deployment info

    try {
      const isValid = await verifyBatcherContract(provider, batcherAddressInput.trim());
      if (isValid) {
        setBatcherAddress(batcherAddressInput.trim());
        setStatus(`Using contract: ${batcherAddressInput.trim()}`);
        setBatcherAddressInput('');
        // Status will be cleared by useEffect after 3 seconds when batcherContract is set
      } else {
        setError('Contract verification failed. The contract may not exist or may not be a valid batcher contract.');
        setStatus(null);
      }
    } catch (err) {
      setError(err.message);
      setStatus(null);
    }
  };

  return (
    <div className="batcher-deployment">
      <h3>Batcher Contract</h3>
      <p>The batcher contract executes your batch transactions. Deploy a new one or use an existing address.</p>

      {batcherContract && (
        <div className="batcher-active">
          <p><strong>Batcher contract set:</strong> {batcherContract.address}</p>
          <button onClick={handleChangeBatcher}>Change</button>
        </div>
      )}

      {!batcherContract && (
        <div className="deployment-options">
          <div className="option">
            <h4>Use Existing Batcher Contract</h4>
            <p className="info">
              If you have previously deployed a batcher contract, enter its address here.
            </p>
            <div className="warning-box" style={{ 
              marginBottom: '1rem', 
              padding: '1rem', 
              background: 'rgba(245, 158, 11, 0.1)', 
              border: '1px solid var(--warning)', 
              borderRadius: '8px' 
            }}>
              <p style={{ margin: 0, color: 'var(--warning)', fontSize: '0.9rem' }}>
                <strong>⚠️ Important:</strong> When reusing a previously deployed contract address, 
                you must ensure that the currently connected safe wallet is the deployer for that contract. 
                The contract will only execute batch calls if the connected safe wallet matches the deployer address 
                set during the original deployment.
              </p>
            </div>
              <input
                type="text"
                value={batcherAddressInput}
                onChange={(e) => setBatcherAddressInput(e.target.value)}
                placeholder="0x..."
              />
            <button onClick={handleUseAddress} disabled={!batcherAddressInput.trim()}>
              Use Address
            </button>
            </div>

            <div className="option">
            <h4>Deploy New Batcher Contract</h4>
              <p className="info">
              Deploy a new batcher contract to execute your batch transactions. 
              The contract will be compiled and deployed automatically. The currently connected wallet 
              will be set as the deployer address with permission to execute batch calls.
            </p>
            <div className="warning-box">
            <h3>⚠️ Important: Save This Information</h3>
            <p>
              <strong>This information is NOT stored permanently.</strong> Once you close this browser tab or reload the page, 
              this data will be lost. Please save the contract address and network information in a secure location.
            </p>
            <ul>
              <li>Copy the contract address and store it securely</li>
              <li>Note which network (chain) this contract is deployed on</li>
              <li>You can reuse this contract address for future rescue operations on the same network</li>
              <li>If you lose this address, you'll need to deploy a new contract</li>
            </ul>
          </div>
            <button 
              onClick={handleDeploy} 
              disabled={deploying || compiling}
            >
              {compiling ? 'Compiling...' : deploying ? 'Deploying...' : 'Deploy Batcher Contract'}
            </button>
            {compiling && (
              <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Compiling Solidity contract in the background...
              </p>
            )}
            {deploying && !compiling && (
              <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Please sign the transaction in MetaMask to deploy the contract.
              </p>
            )}
          </div>
        </div>
      )}

      {status && <div className="status">{status}</div>}
      {error && <div className="error">{error}</div>}

      <div className="info-box">
        <h4>About Batcher Contracts</h4>
        <ul>
          <li>The batcher contract executes multiple calls in a single transaction</li>
          <li>You can reuse the same batcher contract address for multiple rescue operations on the same network</li>
          <li>The contract address will be used for batch execution</li>
          <li><strong>Note:</strong> Contract addresses are not stored permanently. Save the address after deployment for future use.</li>
        </ul>
      </div>

      {showDeploymentModal && deploymentInfo && (
        <BatcherDeploymentModal
          address={deploymentInfo.address}
          chainName={deploymentInfo.chainName}
          chainId={deploymentInfo.chainId}
          txHash={deploymentInfo.txHash}
          onClose={() => {
            setShowDeploymentModal(false);
            setDeploymentInfo(null);
            // Clear status when modal is closed after successful deployment
            // Status will be cleared by useEffect after delay when batcherContract is set
          }}
        />
      )}
    </div>
  );
}
