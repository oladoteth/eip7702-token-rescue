/**
 * EVM Network Configuration
 * Supports all major EVM networks
 */

export const NETWORKS = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: 'https://eth.llamarpc.com',
    rpcUrls: [
      'https://eth.llamarpc.com',
      'https://rpc.ankr.com/eth',
      'https://ethereum.publicnode.com',
      'https://eth.merkle.io',
      'https://1rpc.io/eth'
    ],
    explorer: 'https://etherscan.io',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    // Token discovery: Blockscout instance (null = none that works in browsers) and DefiLlama chain id.
    discovery: { blockscout: 'https://eth.blockscout.com', llama: 'ethereum' }
  },
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    rpcUrl: 'https://rpc.sepolia.org',
    rpcUrls: [
      'https://rpc.sepolia.org',
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://rpc2.sepolia.org'
    ],
    explorer: 'https://sepolia.etherscan.io',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    // Token discovery: Blockscout instance (null = none that works in browsers) and DefiLlama chain id.
    discovery: { blockscout: 'https://eth-sepolia.blockscout.com', llama: null }
  },
  polygon: {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    rpcUrls: [
      'https://polygon-rpc.com',
      'https://rpc.ankr.com/polygon',
      'https://polygon.publicnode.com',
      'https://1rpc.io/matic'
    ],
    explorer: 'https://polygonscan.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    // Token discovery: Blockscout instance (null = none that works in browsers) and DefiLlama chain id.
    discovery: { blockscout: 'https://polygon.blockscout.com', llama: 'polygon' }
  },
  bsc: {
    chainId: 56,
    name: 'BNB Smart Chain',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    rpcUrls: [
      'https://bsc-dataseed.binance.org',
      'https://bsc-dataseed1.defibit.io',
      'https://bsc-dataseed1.ninicoin.io',
      'https://rpc.ankr.com/bsc',
      'https://bsc.publicnode.com'
    ],
    explorer: 'https://bscscan.com',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    // Token discovery: Blockscout instance (null = none that works in browsers) and DefiLlama chain id.
    discovery: { blockscout: null, llama: 'bsc' }
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    rpcUrls: [
      'https://arb1.arbitrum.io/rpc',
      'https://rpc.ankr.com/arbitrum',
      'https://arbitrum-one.publicnode.com',
      'https://1rpc.io/arb'
    ],
    explorer: 'https://arbiscan.io',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    // Token discovery: Blockscout instance (null = none that works in browsers) and DefiLlama chain id.
    discovery: { blockscout: 'https://arbitrum.blockscout.com', llama: 'arbitrum' }
  },
  optimism: {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    rpcUrls: [
      'https://mainnet.optimism.io',
      'https://rpc.ankr.com/optimism',
      'https://optimism.publicnode.com',
      'https://1rpc.io/op'
    ],
    explorer: 'https://optimistic.etherscan.io',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    // Token discovery: Blockscout instance (null = none that works in browsers) and DefiLlama chain id.
    discovery: { blockscout: 'https://optimism.blockscout.com', llama: 'optimism' }
  },
  avalanche: {
    chainId: 43114,
    name: 'Avalanche',
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    rpcUrls: [
      'https://api.avax.network/ext/bc/C/rpc',
      'https://rpc.ankr.com/avalanche',
      'https://avalanche.public-rpc.com',
      'https://1rpc.io/avax/c'
    ],
    explorer: 'https://snowtrace.io',
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    // Token discovery: Blockscout instance (null = none that works in browsers) and DefiLlama chain id.
    discovery: { blockscout: null, llama: 'avax' }
  },
  base: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    rpcUrls: [
      'https://mainnet.base.org',
      'https://base-rpc.publicnode.com',
      'https://1rpc.io/base',
      'https://base.llamarpc.com'
    ],
    explorer: 'https://basescan.org',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    // Token discovery: Blockscout instance (null = none that works in browsers) and DefiLlama chain id.
    discovery: { blockscout: 'https://base.blockscout.com', llama: 'base' }
  },
  zksync: {
    chainId: 324,
    name: 'zkSync Era',
    rpcUrl: 'https://mainnet.era.zksync.io',
    rpcUrls: [
      'https://mainnet.era.zksync.io',
      'https://zksync-era.rpc.thirdweb.com',
      'https://zksync.drpc.org'
    ],
    explorer: 'https://explorer.zksync.io',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    // Token discovery: Blockscout instance (null = none that works in browsers) and DefiLlama chain id.
    discovery: { blockscout: 'https://zksync.blockscout.com', llama: 'era' }
  },
  linea: {
    chainId: 59144,
    name: 'Linea',
    rpcUrl: 'https://rpc.linea.build',
    rpcUrls: [
      'https://rpc.linea.build',
      'https://linea-mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
      'https://1rpc.io/linea'
    ],
    explorer: 'https://lineascan.build',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    // Token discovery: Blockscout instance (null = none that works in browsers) and DefiLlama chain id.
    discovery: { blockscout: null, llama: 'linea' }
  }
};

// Local anvil node for testing a rescue end to end. Only listed in `npm run dev`.
// Start it with: anvil --hardfork prague
if (import.meta.env?.DEV) {
  NETWORKS.anvil = {
    chainId: 31337,
    name: 'Anvil (local)',
    rpcUrl: 'http://127.0.0.1:8545',
    rpcUrls: ['http://127.0.0.1:8545'],
    explorer: '',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: null, llama: null }
  };
  // For a mainnet fork (anvil --fork-url ... --chain-id 31337), set
  // VITE_ANVIL_DISCOVERY_OF=ethereum to reuse that network's discovery sources.
  const forkOf = NETWORKS[import.meta.env.VITE_ANVIL_DISCOVERY_OF];
  if (forkOf) NETWORKS.anvil.discovery = forkOf.discovery;
}

export function getNetworkByChainId(chainId) {
  return Object.values(NETWORKS).find(network => network.chainId === chainId);
}

export function getAllNetworks() {
  return Object.values(NETWORKS);
}

export function getNetworkName(chainId) {
  const network = getNetworkByChainId(chainId);
  return network ? network.name : `Chain ${chainId}`;
}
