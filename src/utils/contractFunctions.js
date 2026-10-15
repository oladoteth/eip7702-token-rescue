/**
 * Contract Function Utilities
 * Extract and categorize functions from ABIs
 */

// One shared parser, so there is a single place that must never evaluate input.
export { parseABI } from './contracts.js';

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
