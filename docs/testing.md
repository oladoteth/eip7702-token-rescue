# Testing

This guide shows how to run Token Rescue's tests and how to test the app against a local chain.

## Before you begin

- Node.js 22 or later.
- [Foundry](https://book.getfoundry.sh/getting-started/installation), for `forge` and `anvil`.
- The `forge-std` submodule. If you cloned the repository without submodules, run:

  ```sh
  git submodule update --init
  ```

## Run the standard tests

```sh
npm test
```

This runs four suites in order:

| Suite | Command | What it covers |
|---|---|---|
| Contract | `forge test` | Unit, fuzz and invariant tests for `RescueDelegate`: only the controller can run batches, required calls are all or nothing, optional calls cannot sink the batch or burn its gas, the native sweep reads the balance when it runs, NFTs can still be received, and the CREATE2 address is deterministic. |
| Unit | `node --test tests/*.test.mjs` | Call review, ABI parsing, custom calls, discovery, approvals, batch splitting, gas limits, the EIP-7702 check and adapter calls. |
| End-to-end | `node scripts/e2e-rescue.mjs` | Starts anvil, then revokes approvals (including one on a hostile token) and rescues an ERC-20, an ERC-721, an ERC-1155 batch and ETH in one transaction using the same code as the app. |
| Split end-to-end | `node scripts/e2e-split.mjs` | Starts anvil with a 1,000,000 block gas limit and rescues 45 tokens plus revokes and ETH in several transactions. |

To run only the unit tests, run `npm run test:unit`.

## Run the protocol adapter test

```sh
npm run test:fork
```

This forks Ethereum mainnet and uses the real Lido, Aave v3 and Uniswap v3 contracts. It needs network access, so it is not part of `npm test`. By default it forks through `https://ethereum.publicnode.com`. To use another RPC, run the script directly:

```sh
forge build
node scripts/fork-positions.mjs https://your-mainnet-rpc.example
```

## Check token discovery against live services

```sh
node scripts/smoke-discovery.mjs [network] [address]
```

This lists and prices an address's tokens through Blockscout, DefiLlama and a public RPC, without signing anything. It defaults to `ethereum` and `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`.

## Test the app against a local chain

In development mode, the network list includes **Anvil (local)** at `http://127.0.0.1:8545`.

1. Start anvil:

   ```sh
   anvil --hardfork prague
   ```

2. In another terminal, start the app:

   ```sh
   npm run dev
   ```

3. Select **Anvil (local)**, then fund the rescue wallet and the compromised wallet from one of anvil's default accounts with `cast send`.

### Use a mainnet fork

To test with real tokens and protocols, fork mainnet and tell the app which network the fork copies:

```sh
anvil --fork-url https://ethereum.publicnode.com --chain-id 31337
VITE_ANVIL_DISCOVERY_OF=ethereum npm run dev
```

`VITE_ANVIL_DISCOVERY_OF` makes **Anvil (local)** use that network's discovery settings and protocol adapters. Blockscout cannot see balances that only exist on the fork, so the token scanner finds only assets the address also holds on mainnet.

## Rebuild the delegate contract

If you change `contracts/RescueDelegate.sol`, regenerate the artifact the app uses:

```sh
forge build
node scripts/export-delegate.mjs
```

This rewrites `src/contracts/rescueDelegate.js`. A change to the bytecode changes the delegate's address on every chain.
