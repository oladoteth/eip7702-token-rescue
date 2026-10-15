/**
 * Contract Function Utilities
 * Extract and categorize functions from ABIs
 */

/**
 * Parse ABI from string input (JSON or JavaScript object notation)
 * @param {string|Array} abiInput - ABI as JSON string, JavaScript object notation, or array
 * @returns {Array} Parsed ABI array
 */
export function parseABI(abiInput) {
  // If already an array, return it
  if (Array.isArray(abiInput)) {
    return abiInput;
  }

  // If not a string, throw error
  if (typeof abiInput !== 'string') {
    throw new Error('ABI must be a string or array');
  }

  // Trim whitespace
  const trimmed = abiInput.trim();
  
  // Try parsing as JSON first (most common case)
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('ABI must be an array');
    }
    return parsed;
  } catch (jsonError) {
    // If JSON parsing fails, try parsing as JavaScript object notation
    // This handles cases where keys are not quoted (e.g., { inputs: [] } instead of { "inputs": [] })
    try {
      // Use Function constructor to safely evaluate JavaScript object notation
      // This is safer than eval as it creates a new function scope
      // Note: This only works for valid JavaScript object/array literals
      const parsed = new Function('return ' + trimmed)();
      
      if (!Array.isArray(parsed)) {
        throw new Error('ABI must be an array');
      }
      
      return parsed;
    } catch (jsError) {
      // If both fail, provide a helpful error message
      throw new Error(`Invalid ABI format: ${jsonError.message}. Please ensure the ABI is valid JSON or JavaScript object notation.`);
    }
  }
}

/**
 * Get all functions from ABI
 * @param {Array} abi - Contract ABI
 * @returns {Array} Array of function objects
 */
export function getFunctionsFromABI(abi) {
  return abi.filter(item => item.type === 'function');
}

/**
 * Get read functions (view/pure)
 * @param {Array} abi - Contract ABI
 * @returns {Array} Array of read function objects
 */
export function getReadFunctions(abi) {
  return getFunctionsFromABI(abi).filter(
    func => func.stateMutability === 'view' || func.stateMutability === 'pure'
  );
}

/**
 * Get write functions (non-payable, payable)
 * @param {Array} abi - Contract ABI
 * @returns {Array} Array of write function objects
 */
export function getWriteFunctions(abi) {
  return getFunctionsFromABI(abi).filter(
    func => func.stateMutability !== 'view' && func.stateMutability !== 'pure'
  );
}

/**
 * Format function signature for display
 * @param {object} func - Function ABI object
 * @returns {string} Formatted function signature
 */
export function formatFunctionSignature(func) {
  const params = func.inputs.map(input => `${input.type} ${input.name || ''}`).join(', ');
  return `${func.name}(${params})`;
}

/**
 * Get function parameter types
 * @param {object} func - Function ABI object
 * @returns {Array} Array of parameter types
 */
export function getFunctionParameterTypes(func) {
  return func.inputs.map(input => input.type);
}

/**
 * Get function parameter names
 * @param {object} func - Function ABI object
 * @returns {Array} Array of parameter names
 */
export function getFunctionParameterNames(func) {
  return func.inputs.map(input => input.name || '');
}

/**
 * Validate function parameters
 * @param {object} func - Function ABI object
 * @param {Array} values - Parameter values
 * @returns {object} Validation result
 */
export function validateFunctionParameters(func, values) {
  if (values.length !== func.inputs.length) {
    return {
      valid: false,
      error: `Expected ${func.inputs.length} parameters, got ${values.length}`
    };
  }

  // Basic type validation could be added here
  return { valid: true };
}
