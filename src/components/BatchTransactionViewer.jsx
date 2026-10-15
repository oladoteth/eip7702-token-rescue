import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { ethers } from 'ethers';

/**
 * Format function name to be human-readable
 * Converts camelCase/PascalCase to Title Case with spaces
 * Example: "transferFrom" -> "Transfer From"
 */
function formatFunctionName(functionName) {
  if (!functionName) return 'Unknown Function';
  
  // Handle common patterns
  const formatted = functionName
    // Insert space before capital letters (camelCase/PascalCase)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Insert space before numbers
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    // Capitalize first letter of each word
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  return formatted;
}

export function BatchTransactionViewer() {
  const { batchCalls, reorderBatchCall, removeBatchCall } = useApp();
  const [draggedIndex, setDraggedIndex] = useState(null);

  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (targetIndex) => {
    if (draggedIndex !== null && draggedIndex !== targetIndex) {
      reorderBatchCall(draggedIndex, targetIndex);
    }
    setDraggedIndex(null);
  };

  const formatValue = (value) => {
    try {
      const bigValue = BigInt(value);
      if (bigValue === 0n) return '0 ETH';
      return `${ethers.formatEther(bigValue)} ETH`;
    } catch {
      return value.toString();
    }
  };

  const formatData = (data) => {
    if (!data || data === '0x') return 'No data';
    if (data.length > 66) {
      return `${data.slice(0, 20)}...${data.slice(-10)}`;
    }
    return data;
  };

  const formatAddress = (address) => {
    if (!address) return 'N/A';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (batchCalls.length === 0) {
    return (
      <div className="batch-viewer-empty">
        <p>No transactions in batch. Add transactions using the contract loader or batch builder.</p>
      </div>
    );
  }

  return (
    <div className="batch-transaction-viewer">
      <h3>Transaction Batch ({batchCalls.length} transactions)</h3>
      <p className="info-text">Drag to reorder transactions. They will execute in the order shown below.</p>
      
      <div className="batch-list">
        {batchCalls.map((call, index) => (
          <div
            key={index}
            className={`batch-item ${draggedIndex === index ? 'dragging' : ''}`}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(index)}
          >
            <div className="batch-item-header">
              <span className="batch-index">#{index + 1}</span>
              <button onClick={() => removeBatchCall(index)} className="remove-btn">Remove</button>
            </div>
            
            <div className="batch-item-content">
              <div className="batch-detail-row">
                <div className="batch-detail">
                  <strong>Contract Name:</strong>
                  <span>{call.contractName || 'Unknown Contract'}</span>
                </div>
                <div className="batch-detail">
                  <strong>Contract Address:</strong>
                  <code className="address-code">{formatAddress(call.target)}</code>
                  <span className="full-address" title={call.target}>{call.target}</span>
                </div>
              </div>
              
              {call.functionName && (
                <div className="batch-detail">
                  <strong>Function:</strong>
                  <span className="function-name">{formatFunctionName(call.functionName)}</span>
                  <code className="function-signature" title={call.functionName}>({call.functionName})</code>
                </div>
              )}
              
              {call.args && call.args.length > 0 && (
                <div className="batch-detail">
                  <strong>Arguments ({call.args.length}):</strong>
                  <ul className="args-list">
                    {call.args.map((arg, idx) => (
                      <li key={idx}>
                        <code>{String(arg)}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              <div className="batch-detail-row">
                <div className="batch-detail">
                  <strong>Value:</strong>
                  <span className={BigInt(call.value || 0) > 0n ? 'value-nonzero' : 'value-zero'}>
                    {formatValue(call.value || 0)}
                  </span>
                </div>
                <div className="batch-detail">
                  <strong>Data:</strong>
                  <code className="data-preview" title={call.data}>{formatData(call.data)}</code>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="batch-summary">
        <h4>Batch Summary</h4>
        <div className="summary-stats">
          <div>
            <strong>Total Transactions:</strong> {batchCalls.length}
          </div>
          <div>
            <strong>Total Value:</strong> {formatValue(
              batchCalls.reduce((sum, call) => {
                try {
                  return sum + BigInt(call.value || 0);
                } catch {
                  return sum;
                }
              }, 0n)
            )}
          </div>
          <div>
            <strong>Unique Contracts:</strong> {
              new Set(batchCalls.map(c => c.target.toLowerCase())).size
            }
          </div>
        </div>
      </div>
    </div>
  );
}
