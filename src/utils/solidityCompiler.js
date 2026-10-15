/**
 * Solidity Compilation Utilities
 * Compiles Solidity code in the browser using Web Workers
 * Based on solc-js browser usage pattern: https://github.com/argotorg/solc-js#browser-usage
 */

let worker = null;
let workerReady = false;
let pendingOperations = new Map();
let operationId = 0;

/**
 * Initialize the Web Worker for compilation
 */
function initWorker() {
  if (worker) {
    return worker;
  }

  try {
    // Create worker as classic script (not ES module) to support importScripts
    // The soljson scripts need importScripts which doesn't work in ES module workers
    worker = new Worker(
      new URL('./solidityCompiler.worker.js', import.meta.url)
      // Don't specify type: 'module' - use classic worker for importScripts support
    );
  } catch (error) {
    console.error('Failed to create worker:', error);
    throw new Error(`Failed to create compilation worker: ${error.message}`);
  }

  worker.onmessage = (e) => {
    const { type, version, output, error, operationId: opId } = e.data;

    if (type === 'loaded') {
      workerReady = true;
      const pending = pendingOperations.get('load');
      if (pending) {
        pending.resolve();
        pendingOperations.delete('load');
      }
    } else if (type === 'compiled') {
      const pending = pendingOperations.get(opId);
      if (pending) {
        pending.resolve(output);
        pendingOperations.delete(opId);
      }
    } else if (type === 'error') {
      // Handle errors
      const pending = pendingOperations.get(opId || 'load');
      if (pending) {
        pending.reject(new Error(error));
        pendingOperations.delete(opId || 'load');
      }
    }
  };

  worker.onerror = (error) => {
    console.error('Worker error:', error);
    const errorMessage = error.message || error.toString() || 'Unknown worker error';
    const errorObj = new Error(`Worker error: ${errorMessage}`);
    
    // Try to reject any pending operations
    for (const [key, pending] of pendingOperations.entries()) {
      pending.reject(errorObj);
      pendingOperations.delete(key);
    }
  };

  return worker;
}

/**
 * Load compiler version in worker
 */
async function loadCompiler(version) {
  if (workerReady) {
    return; // Already loaded
  }

  const w = initWorker();

  return new Promise((resolve, reject) => {
    pendingOperations.set('load', { resolve, reject });
    w.postMessage({ type: 'load', version });
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingOperations.has('load')) {
        pendingOperations.delete('load');
        reject(new Error('Compiler load timeout'));
      }
    }, 30000);
  });
}

/**
 * Compile Solidity contract code
 * @param {string} solidityCode - Solidity source code
 * @param {string} contractName - Name of the contract to compile
 * @returns {Promise<{bytecode: string, abi: Array}>}
 */
export async function compileSolidity(solidityCode, contractName = 'Batcher') {
  try {
    // Use 0.8.24 which is widely available and compatible with ^0.8.24 pragma
    // The contract uses pragma ^0.8.24, so 0.8.24 compiler will work
    const compilerVersion = '0.8.24';
    
    // Ensure worker is initialized and compiler is loaded
    await loadCompiler(compilerVersion);
    
    const input = {
      language: 'Solidity',
      sources: {
        'contract.sol': {
          content: solidityCode
        }
      },
      settings: {
        outputSelection: {
          '*': {
            '*': ['abi', 'evm.bytecode']
          }
        }
      }
    };

    // Stringify the input JSON
    let inputJson;
    try {
      inputJson = JSON.stringify(input);
      console.log('[Compiler] Input JSON length:', inputJson.length);
      console.log('[Compiler] Input JSON first 500 chars:', inputJson.substring(0, 500));
      console.log('[Compiler] Input JSON around position 5064:', inputJson.substring(5050, 5080));
      
      // Validate the JSON is valid before sending
      JSON.parse(inputJson);
      console.log('[Compiler] Input JSON is valid');
    } catch (e) {
      console.error('[Compiler] Input JSON is invalid!', e);
      console.error('[Compiler] Solidity code length:', solidityCode.length);
      throw new Error(`Invalid input JSON: ${e.message}`);
    }

    // Compile in worker
    const w = initWorker();
    const opId = ++operationId;
    
    const outputStr = await new Promise((resolve, reject) => {
      pendingOperations.set(opId, { resolve, reject });
      w.postMessage({ 
        type: 'compile', 
        input: inputJson,
        operationId: opId
      });
      
      // Timeout after 60 seconds
      setTimeout(() => {
        if (pendingOperations.has(opId)) {
          pendingOperations.delete(opId);
          reject(new Error('Compilation timeout'));
        }
      }, 60000);
    });

    // Parse the output JSON
    let output;
    try {
      output = JSON.parse(outputStr);
    } catch (parseError) {
      // If JSON parsing fails, log details for debugging
      console.error('Failed to parse compilation output:', parseError);
      console.error('Output length:', outputStr?.length);
      console.error('Output preview (first 500 chars):', outputStr?.substring(0, 500));
      console.error('Output preview (last 500 chars):', outputStr?.substring(Math.max(0, outputStr.length - 500)));
      throw new Error(`Failed to parse compilation output: ${parseError.message}. Output may be truncated or corrupted.`);
    }
    
    // Check for compilation errors
    if (output.errors) {
      const errors = output.errors.filter(e => e.severity === 'error');
      const warnings = output.errors.filter(e => e.severity === 'warning');
      
      if (errors.length > 0) {
        const errorMessages = errors.map(e => `${e.type}: ${e.message}`).join('; ');
        throw new Error(`Compilation errors: ${errorMessages}`);
      }
      
      if (warnings.length > 0) {
        console.warn('Compilation warnings:', warnings.map(w => w.message).join('; '));
      }
    }

    const contract = output.contracts['contract.sol'][contractName];
    if (!contract) {
      const contracts = output.contracts['contract.sol'];
      const contractNames = Object.keys(contracts);
      if (contractNames.length === 0) {
        throw new Error('No contracts found in Solidity code');
      }
      if (contractNames.length === 1) {
        const foundContract = contracts[contractNames[0]];
        return {
          bytecode: foundContract.evm.bytecode.object,
          abi: foundContract.abi
        };
      }
      throw new Error(`Contract "${contractName}" not found. Available contracts: ${contractNames.join(', ')}`);
    }

    return {
      bytecode: contract.evm.bytecode.object,
      abi: contract.abi
    };
  } catch (error) {
    console.error('Compilation error:', error);
    throw new Error(`Failed to compile Solidity: ${error.message}`);
  }
}

/**
 * Replace placeholder in Solidity code with actual address
 * @param {string} solidityCode - Solidity source code
 * @param {string} placeholder - Placeholder to replace (e.g., '{{MASTER_ADDRESS}}')
 * @param {string} address - Address to insert
 * @returns {string} Modified Solidity code
 */
export function replaceAddressInSolidity(solidityCode, placeholder, address) {
  if (!address || !address.startsWith('0x')) {
    throw new Error('Invalid address format');
  }
  
  if (!solidityCode.includes(placeholder)) {
    throw new Error(`Placeholder ${placeholder} not found in Solidity code`);
  }
  
  return solidityCode.replace(new RegExp(placeholder, 'g'), address);
}

