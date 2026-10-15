/**
 * Web Worker for Solidity Compilation
 * Based on solc-js browser usage pattern
 * See: https://github.com/argotorg/solc-js#browser-usage
 * 
 * Note: This is a classic worker (not ES module) to support importScripts()
 */

let compiler = null;
let compilerVersion = null;

/**
 * Create compiler wrapper that uses WASM functions directly
 * This bypasses cwrap/ccall which have issues in this environment
 */
function createCompilerWrapper(Module) {
  // Check what's available
  console.log('[Worker] Module keys:', Object.keys(Module).slice(0, 20));
  
  // We need _solidity_compile and memory management functions
  if (!Module._solidity_compile || typeof Module._solidity_compile !== 'function') {
    throw new Error('Module._solidity_compile not available');
  }
  
  if (!Module._malloc || !Module._free || !Module.stringToUTF8 || !Module.UTF8ToString) {
    throw new Error('Module missing required memory management functions');
  }
  
  // Get string length function - use Module's function if available
  const getStringLength = Module.lengthBytesUTF8 || function(str) {
    // Use stringToUTF8 to write to a temp buffer to get exact length
    // This is more accurate than manual calculation
    if (Module.stringToUTF8) {
      // Create a temporary buffer to measure
      const tempPtr = Module._malloc(str.length * 4 + 1); // Allocate enough space
      try {
        Module.stringToUTF8(str, tempPtr, str.length * 4 + 1);
        // Find the actual length by scanning for null
        let len = 0;
        while (len < str.length * 4 && Module.HEAPU8[tempPtr + len] !== 0) {
          len++;
        }
        Module._free(tempPtr);
        return len + 1; // +1 for null terminator
      } catch (e) {
        Module._free(tempPtr);
        // Fallback to manual calculation
      }
    }
    // Fallback: manual UTF-8 length calculation
    let len = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 0x80) len += 1;
      else if (code < 0x800) len += 2;
      else if (code < 0xD800 || code >= 0xE000) len += 3;
      else {
        // Surrogate pair
        i++;
        len += 4;
      }
    }
    return len + 1; // +1 for null terminator
  };
  
  return {
    compile: (input) => {
      // Input is already a JSON string from main thread
      const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
      
      console.log('[Worker] Input JSON string length:', inputStr.length);
      console.log('[Worker] Input JSON first 500 chars:', inputStr.substring(0, 500));
      if (inputStr.length > 5064) {
        console.log('[Worker] Input JSON around position 5064:', inputStr.substring(5050, 5080));
      }
      
      // Validate input JSON before sending to compiler
      try {
        const parsed = JSON.parse(inputStr);
        console.log('[Worker] Input JSON is valid, has sources:', !!parsed.sources);
      } catch (e) {
        console.error('[Worker] Input JSON is invalid!', e.message);
        throw new Error(`Invalid input JSON: ${e.message}`);
      }
      
      let inputPtr = null;
      let outputPtr = null;
      
      try {
        // Reset the compiler state (important for multiple compilations)
        if (Module._solidity_reset && typeof Module._solidity_reset === 'function') {
          Module._solidity_reset();
        }
        
        // Calculate and allocate memory for input string
        // CRITICAL: Use lengthBytesUTF8 to get exact byte length
        let inputLen;
        if (Module.lengthBytesUTF8) {
          inputLen = Module.lengthBytesUTF8(inputStr) + 1; // +1 for null terminator
        } else {
          inputLen = getStringLength(inputStr);
        }
        
        console.log('[Worker] Allocating', inputLen, 'bytes for input (string length:', inputStr.length, ')');
        
        const allocFunc = Module._solidity_alloc || Module._malloc;
        inputPtr = allocFunc(inputLen);
        
        if (!inputPtr) {
          throw new Error('Failed to allocate memory for input');
        }
        
        // Write input string to WASM memory
        // stringToUTF8 writes the string and adds a null terminator
        Module.stringToUTF8(inputStr, inputPtr, inputLen);
        
        // Verify the string was written correctly
        const writtenStr = Module.UTF8ToString(inputPtr);
        if (writtenStr !== inputStr) {
          console.error('[Worker] String mismatch! Original length:', inputStr.length, 'Written length:', writtenStr.length);
          console.error('[Worker] Original last 100:', inputStr.substring(Math.max(0, inputStr.length - 100)));
          console.error('[Worker] Written last 100:', writtenStr.substring(Math.max(0, writtenStr.length - 100)));
          throw new Error('String was not written correctly to WASM memory');
        }
        console.log('[Worker] String verified - written correctly, length:', writtenStr.length);
        
        // Call the WASM compile function
        // _solidity_compile allocates its own memory for the output using _solidity_alloc
        outputPtr = Module._solidity_compile(inputPtr);
        
        if (!outputPtr) {
          throw new Error('Compilation returned null pointer');
        }
        
        // Read result string from WASM memory
        // _solidity_compile returns a pointer to a null-terminated C string
        // UTF8ToString reads until the first null byte, which is correct for null-terminated strings
        const result = Module.UTF8ToString(outputPtr);
        
        if (!result || result.length === 0) {
          throw new Error('Compilation returned empty result');
        }
        
        console.log('[Worker] Read compilation result, length:', result.length);
        
        // Verify the result is valid JSON before returning
        if (!result || result.length === 0) {
          throw new Error('Compilation returned empty result');
        }
        
        // The result should be valid JSON
        // If parsing fails, it means the string is truncated or corrupted
        try {
          JSON.parse(result);
        } catch (parseError) {
          // Log detailed error information for debugging
          console.error('[Worker] JSON parse error:', parseError.message);
          console.error('[Worker] Result length:', result.length);
          console.error('[Worker] Result preview (first 500):', result.substring(0, 500));
          console.error('[Worker] Result preview (last 500):', result.substring(Math.max(0, result.length - 500)));
          console.error('[Worker] Character at position 5064:', result.charCodeAt(5063), result.substring(5060, 5070));
          
          // Check if the string looks truncated (doesn't end with })
          const trimmedCheck = result.trim();
          if (!trimmedCheck.endsWith('}') && !trimmedCheck.endsWith(']')) {
            throw new Error(`Compilation result appears truncated at length ${result.length}. Expected JSON but string is incomplete. Last 100 chars: ${result.substring(Math.max(0, result.length - 100))}`);
          }
          
          // Re-throw the parse error with more context
          throw new Error(`Invalid JSON from compiler: ${parseError.message}. String length: ${result.length}`);
        }
        
        // Free allocated memory
        // Use _solidity_free for both input and output (solc-specific memory management)
        const freeFunc = Module._solidity_free || Module._free;
        if (inputPtr) {
          freeFunc(inputPtr);
        }
        if (outputPtr && outputPtr !== inputPtr) {
          freeFunc(outputPtr);
        }
        
        return result;
      } catch (error) {
        // Clean up memory on error
        if (inputPtr) {
          try {
            Module._free(inputPtr);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        if (outputPtr && outputPtr !== inputPtr) {
          try {
            Module._free(outputPtr);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        
        console.error('[Worker] Compilation error:', error);
        throw new Error(`Compilation failed: ${error.message}`);
      }
    },
    version: () => {
      // Try to get version if available
      if (Module._solidity_version && typeof Module._solidity_version === 'function') {
        try {
          const versionPtr = Module._solidity_version();
          if (versionPtr) {
            return Module.UTF8ToString(versionPtr);
          }
        } catch (e) {
          // Ignore version errors
        }
      }
      return '0.8.24';
    }
  };
}

// Listen for messages from main thread
self.addEventListener('message', async (e) => {
  const { type, version, input, operationId: opId } = e.data;

  try {
    if (type === 'load') {
      // Load compiler version
      if (compiler && compilerVersion === version) {
        self.postMessage({ type: 'loaded', version });
        return;
      }

      // Load soljson script dynamically
      const loadVersion = '0.8.24';
      const commitHash = 'e11b9ed9';
      const scriptUrl = `https://binaries.soliditylang.org/bin/soljson-v${loadVersion}+commit.${commitHash}.js`;
      
      console.log(`[Worker] Loading compiler ${loadVersion} (requested ${version}) from: ${scriptUrl}`);
      
      // Import the script - this will set self.Module
      importScripts(scriptUrl);
      
      // Wait for Module to fully initialize
      // The soljson script sets up Module asynchronously, and WASM needs time to load
      let attempts = 0;
      const maxAttempts = 100; // 10 seconds max
      
      while (attempts < maxAttempts) {
        if (self.Module) {
          // Check if Module has all required functions
          if (self.Module._solidity_compile && 
              typeof self.Module._solidity_compile === 'function' &&
              self.Module._malloc && 
              typeof self.Module._malloc === 'function' &&
              self.Module._free && 
              typeof self.Module._free === 'function' &&
              self.Module.stringToUTF8 && 
              typeof self.Module.stringToUTF8 === 'function' &&
              self.Module.UTF8ToString && 
              typeof self.Module.UTF8ToString === 'function') {
            // Module is ready!
            console.log('[Worker] Module is ready with all required functions');
            break;
          }
        }
        
        if (attempts % 10 === 0) {
          console.log(`[Worker] Waiting for Module to initialize (attempt ${attempts + 1}/${maxAttempts})...`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      if (!self.Module) {
        throw new Error('Module not available after loading script');
      }
      
      // Verify all required functions are available
      const required = ['_solidity_compile', '_malloc', '_free', 'stringToUTF8', 'UTF8ToString'];
      const missing = required.filter(fn => !self.Module[fn] || typeof self.Module[fn] !== 'function');
      
      if (missing.length > 0) {
        throw new Error(`Module missing required functions: ${missing.join(', ')}`);
      }
      
      // Create compiler wrapper
      compiler = createCompilerWrapper(self.Module);
      compilerVersion = version;
      console.log('[Worker] Compiler loaded successfully');
      self.postMessage({ type: 'loaded', version });
      
    } else if (type === 'compile') {
      if (!compiler) {
        throw new Error('Compiler not loaded. Call load first.');
      }

      console.log('[Worker] Compiling Solidity code...');
      
      // Compile the Solidity code
      // Input is already a JSON string from main thread
      const output = compiler.compile(input);
      
      console.log('[Worker] Compilation successful');
      self.postMessage({ type: 'compiled', output, operationId: opId });
    }
  } catch (error) {
    console.error('[Worker] Error:', error);
    self.postMessage({ 
      type: 'error', 
      error: error.message,
      stack: error.stack,
      operationId: opId
    });
  }
});
