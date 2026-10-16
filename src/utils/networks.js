/**
 * EVM networks with EIP-7702. Every RPC and Blockscout URL here was checked from a browser
 * (CORS) on 2026-10-16, and every chain passed the live 7702 probe in eip7702Probe.js.
 * The app still probes the RPC it actually uses, so this list is a starting point, not proof.
 * discovery.blockscout is null where no instance answers browser requests.
 */

export const NETWORKS = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: 'https://ethereum.publicnode.com',
    rpcUrls: [
      'https://ethereum.publicnode.com',
      'https://1rpc.io/eth'
    ],
    explorer: 'https://etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: 'https://eth.blockscout.com', llama: 'ethereum' }
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    rpcUrls: [
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum-one-rpc.publicnode.com',
      'https://1rpc.io/arb'
    ],
    explorer: 'https://arbiscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: 'https://arbitrum.blockscout.com', llama: 'arbitrum' }
  },
  base: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    rpcUrls: [
      'https://mainnet.base.org',
      'https://base-rpc.publicnode.com',
      'https://1rpc.io/base'
    ],
    explorer: 'https://basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: 'https://base.blockscout.com', llama: 'base' }
  },
  optimism: {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    rpcUrls: [
      'https://mainnet.optimism.io',
      'https://optimism-rpc.publicnode.com',
      'https://1rpc.io/op'
    ],
    explorer: 'https://optimistic.etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: 'https://optimism.blockscout.com', llama: 'optimism' }
  },
  polygon: {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: 'https://polygon-bor-rpc.publicnode.com',
    rpcUrls: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://1rpc.io/matic'
    ],
    explorer: 'https://polygonscan.com',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    discovery: { blockscout: 'https://polygon.blockscout.com', llama: 'polygon' }
  },
  bsc: {
    chainId: 56,
    name: 'BNB Smart Chain',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    rpcUrls: [
      'https://bsc-dataseed.binance.org',
      'https://bsc-rpc.publicnode.com',
      'https://bsc-dataseed1.defibit.io'
    ],
    explorer: 'https://bscscan.com',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    discovery: { blockscout: null, llama: 'bsc' }
  },
  linea: {
    chainId: 59144,
    name: 'Linea',
    rpcUrl: 'https://rpc.linea.build',
    rpcUrls: [
      'https://rpc.linea.build',
      'https://linea-rpc.publicnode.com',
      'https://1rpc.io/linea'
    ],
    explorer: 'https://lineascan.build',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: null, llama: 'linea' }
  },
  gnosis: {
    chainId: 100,
    name: 'Gnosis',
    rpcUrl: 'https://rpc.gnosischain.com',
    rpcUrls: [
      'https://rpc.gnosischain.com',
      'https://gnosis-rpc.publicnode.com'
    ],
    explorer: 'https://gnosisscan.io',
    nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
    discovery: { blockscout: null, llama: 'xdai' }
  },
  unichain: {
    chainId: 130,
    name: 'Unichain',
    rpcUrl: 'https://mainnet.unichain.org',
    rpcUrls: [
      'https://mainnet.unichain.org',
      'https://unichain-rpc.publicnode.com'
    ],
    explorer: 'https://uniscan.xyz',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: 'https://unichain.blockscout.com', llama: 'unichain' }
  },
  ink: {
    chainId: 57073,
    name: 'Ink',
    rpcUrl: 'https://rpc-gel.inkonchain.com',
    rpcUrls: [
      'https://rpc-gel.inkonchain.com',
      'https://rpc-qnd.inkonchain.com'
    ],
    explorer: 'https://explorer.inkonchain.com',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: 'https://explorer.inkonchain.com', llama: 'ink' }
  },
  soneium: {
    chainId: 1868,
    name: 'Soneium',
    rpcUrl: 'https://rpc.soneium.org',
    rpcUrls: [
      'https://rpc.soneium.org',
      'https://soneium-rpc.publicnode.com'
    ],
    explorer: 'https://soneium.blockscout.com',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: 'https://soneium.blockscout.com', llama: 'soneium' }
  },
  worldchain: {
    chainId: 480,
    name: 'World Chain',
    rpcUrl: 'https://worldchain-mainnet.g.alchemy.com/public',
    rpcUrls: [
      'https://worldchain-mainnet.g.alchemy.com/public'
    ],
    explorer: 'https://worldscan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: 'https://worldchain-mainnet.explorer.alchemy.com', llama: 'wc' }
  },
  scroll: {
    chainId: 534352,
    name: 'Scroll',
    rpcUrl: 'https://rpc.scroll.io',
    rpcUrls: [
      'https://rpc.scroll.io',
      'https://scroll-rpc.publicnode.com'
    ],
    explorer: 'https://scrollscan.com',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: null, llama: 'scroll' }
  },
  arbitrumNova: {
    chainId: 42170,
    name: 'Arbitrum Nova',
    rpcUrl: 'https://nova.arbitrum.io/rpc',
    rpcUrls: [
      'https://nova.arbitrum.io/rpc',
      'https://arbitrum-nova-rpc.publicnode.com'
    ],
    explorer: 'https://nova.arbiscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: 'https://arbitrum-nova.blockscout.com', llama: 'arbitrum_nova' }
  },
  celo: {
    chainId: 42220,
    name: 'Celo',
    rpcUrl: 'https://forno.celo.org',
    rpcUrls: [
      'https://forno.celo.org',
      'https://celo-rpc.publicnode.com'
    ],
    explorer: 'https://celoscan.io',
    nativeCurrency: { name: 'Celo', symbol: 'CELO', decimals: 18 },
    discovery: { blockscout: 'https://celo.blockscout.com', llama: 'celo' }
  },
  mantle: {
    chainId: 5000,
    name: 'Mantle',
    rpcUrl: 'https://rpc.mantle.xyz',
    rpcUrls: [
      'https://rpc.mantle.xyz',
      'https://mantle-rpc.publicnode.com'
    ],
    explorer: 'https://mantlescan.xyz',
    nativeCurrency: { name: 'Mantle', symbol: 'MNT', decimals: 18 },
    discovery: { blockscout: null, llama: 'mantle' }
  },
  berachain: {
    chainId: 80094,
    name: 'Berachain',
    rpcUrl: 'https://rpc.berachain.com',
    rpcUrls: [
      'https://rpc.berachain.com',
      'https://berachain-rpc.publicnode.com'
    ],
    explorer: 'https://berascan.com',
    nativeCurrency: { name: 'Bera', symbol: 'BERA', decimals: 18 },
    discovery: { blockscout: null, llama: 'berachain' }
  },
  sonic: {
    chainId: 146,
    name: 'Sonic',
    rpcUrl: 'https://rpc.soniclabs.com',
    rpcUrls: [
      'https://rpc.soniclabs.com',
      'https://sonic-rpc.publicnode.com'
    ],
    explorer: 'https://sonicscan.org',
    nativeCurrency: { name: 'Sonic', symbol: 'S', decimals: 18 },
    discovery: { blockscout: null, llama: 'sonic' }
  },
  plasma: {
    chainId: 9745,
    name: 'Plasma',
    rpcUrl: 'https://rpc.plasma.to',
    rpcUrls: [
      'https://rpc.plasma.to'
    ],
    explorer: 'https://plasmascan.to',
    nativeCurrency: { name: 'Plasma', symbol: 'XPL', decimals: 18 },
    discovery: { blockscout: null, llama: 'plasma' }
  },
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    testnet: true,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    rpcUrls: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://sepolia.drpc.org'
    ],
    explorer: 'https://sepolia.etherscan.io',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: 'https://eth-sepolia.blockscout.com', llama: null }
  },
  hoodi: {
    chainId: 560048,
    name: 'Hoodi',
    testnet: true,
    rpcUrl: 'https://ethereum-hoodi-rpc.publicnode.com',
    rpcUrls: [
      'https://ethereum-hoodi-rpc.publicnode.com',
      'https://0xrpc.io/hoodi'
    ],
    explorer: 'https://hoodi.etherscan.io',
    nativeCurrency: { name: 'Hoodi Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: 'https://eth-hoodi.blockscout.com', llama: null }
  },
  baseSepolia: {
    chainId: 84532,
    name: 'Base Sepolia',
    testnet: true,
    rpcUrl: 'https://sepolia.base.org',
    rpcUrls: [
      'https://sepolia.base.org',
      'https://base-sepolia-rpc.publicnode.com'
    ],
    explorer: 'https://sepolia.basescan.org',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    discovery: { blockscout: 'https://base-sepolia.blockscout.com', llama: null }
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
  if (forkOf) {
    NETWORKS.anvil.discovery = forkOf.discovery;
    // Protocol adapters look up contract addresses by this chain id.
    NETWORKS.anvil.positionsChainId = forkOf.chainId;
  }
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
