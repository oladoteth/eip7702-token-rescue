// Read-only smoke test of asset discovery against live services:
// Blockscout, DefiLlama and a public RPC (Multicall3 path).
//
//   node scripts/smoke-discovery.mjs [network] [address]
//
// Defaults to Ethereum and vitalik.eth. Sends only the address, never a key.
import { ethers } from 'ethers';
import { NETWORKS } from '../src/utils/networks.js';
import { discoverErc20 } from '../src/discovery/index.js';

const network = NETWORKS[process.argv[2] ?? 'ethereum'];
const address = process.argv[3] ?? '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const rpc = network.rpcUrls.find((url) => url.includes('publicnode')) ?? network.rpcUrl;
const provider = new ethers.JsonRpcProvider(rpc, network.chainId, { staticNetwork: true, cacheTimeout: -1 });

const started = Date.now();
const { assets, truncated, skippedUnpriced, pricesUnavailable } = await discoverErc20({
  network,
  address,
  provider,
  onProgress: (stage) => console.log('..', stage)
});

const counts = Object.groupBy(assets, (a) => a.category);
console.log(`\n${network.name} ${address} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('truncated:', truncated, '| skippedUnpriced:', skippedUnpriced, '| pricesUnavailable:', pricesUnavailable);
for (const category of ['valuable', 'dust', 'unpriced', 'spam']) {
  console.log(`${category}: ${counts[category]?.length ?? 0}`);
}
console.log('\nTop valuable:');
for (const a of (counts.valuable ?? []).slice(0, 5)) {
  console.log(`  ${a.symbol.padEnd(10)} $${a.valueUsd.toFixed(2).padStart(12)}  ${a.token}`);
}
console.log('\nSample spam:');
for (const a of (counts.spam ?? []).slice(0, 5)) {
  console.log(`  ${a.name.slice(0, 50)}`);
}
